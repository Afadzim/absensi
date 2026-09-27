import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthSessionService } from "./auth.session.service.js";
import {
  hashCsrfToken,
  hashPassword,
  hashSessionToken,
} from "./auth.crypto.js";
import { AUTH_CONSTANTS } from "./auth.constants.js";
import { closeTestDb, testPrisma } from "../../test/db.js";

function suffix(): string {
  return `${Date.now().toString().slice(-8)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function plusMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

type AuthFixture = {
  institutionAId: string;
  institutionBId: string;
  userAId: string;
  userBId: string;
  teacherAId: string;
  roleId: string;
  roleName: string;
  permissionId: string;
  permissionCode: string;
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  cleanup: () => Promise<void>;
};

let fixture: AuthFixture;

let now = new Date("2026-09-27T10:00:00.000Z");

function createService(): AuthSessionService {
  return new AuthSessionService({
    now: () => new Date(now),
  });
}

async function createFixture(): Promise<AuthFixture> {
  const s = suffix();
  const passwordHash = await hashPassword("Test password 123456");

  const institutionA = await testPrisma.institution.create({
    data: {
      code: `AUTH-A-${s}`,
      name: `Auth Test A ${s}`,
    },
  });

  const institutionB = await testPrisma.institution.create({
    data: {
      code: `AUTH-B-${s}`,
      name: `Auth Test B ${s}`,
    },
  });

  const roleName = `AUTH_ROLE_${s}`;

  const role = await testPrisma.role.create({
    data: {
      name: roleName,
      description: "Auth session test role",
    },
  });

  const permissionCode = `auth.test.permission.${s}`;

  const permission = await testPrisma.permission.create({
    data: {
      code: permissionCode,
      description: "Auth session test permission",
    },
  });

  await testPrisma.rolePermission.create({
    data: {
      roleId: role.id,
      permissionId: permission.id,
    },
  });

  const userA = await testPrisma.user.create({
    data: {
      institutionId: institutionA.id,
      username: `auth-user-a-${s}`,
      passwordHash,
      status: "ACTIVE",
    },
  });

  const userB = await testPrisma.user.create({
    data: {
      institutionId: institutionB.id,
      username: `auth-user-b-${s}`,
      passwordHash,
      status: "ACTIVE",
    },
  });

  await testPrisma.userRole.create({
    data: {
      userId: userA.id,
      roleId: role.id,
    },
  });

  const teacherA = await testPrisma.teacher.create({
    data: {
      institutionId: institutionA.id,
      code: `AUTH-T-${s}`,
      name: `Auth Teacher ${s}`,
      userId: userA.id,
      userInstitutionId: institutionA.id,
    },
  });

  const session = await createService().createSession({
    userId: userA.id,
    institutionId: institutionA.id,
    ipAddress: "127.0.0.1",
    userAgent: "vitest-auth-session",
  });

  return {
    institutionAId: institutionA.id,
    institutionBId: institutionB.id,
    userAId: userA.id,
    userBId: userB.id,
    teacherAId: teacherA.id,
    roleId: role.id,
    roleName,
    permissionId: permission.id,
    permissionCode,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    csrfToken: session.csrfToken,
    cleanup: async () => {
      await testPrisma.authSession.deleteMany({
        where: {
          institutionId: {
            in: [institutionA.id, institutionB.id],
          },
        },
      });

      await testPrisma.userRole.deleteMany({
        where: {
          userId: {
            in: [userA.id, userB.id],
          },
        },
      });

      await testPrisma.teacher.deleteMany({
        where: {
          institutionId: {
            in: [institutionA.id, institutionB.id],
          },
        },
      });

      await testPrisma.user.deleteMany({
        where: {
          id: {
            in: [userA.id, userB.id],
          },
        },
      });

      await testPrisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
        },
      });

      await testPrisma.permission.delete({
        where: {
          id: permission.id,
        },
      });

      await testPrisma.role.delete({
        where: {
          id: role.id,
        },
      });

      await testPrisma.institution.deleteMany({
        where: {
          id: {
            in: [institutionA.id, institutionB.id],
          },
        },
      });
    },
  };
}

beforeAll(async () => {
  fixture = await createFixture();
});

afterAll(async () => {
  await fixture?.cleanup();
  await closeTestDb();
});

describe("AuthSessionService", () => {
  it("4B-001: membuat session untuk user ACTIVE", () => {
    expect(fixture.sessionId).toMatch(
      /^[0-9a-f-]{36}$/u,
    );

    expect(fixture.sessionToken.length).toBeGreaterThan(30);
    expect(fixture.csrfToken.length).toBeGreaterThan(30);
  });

  it("4B-002: database hanya menyimpan hash session token", async () => {
    const row = await testPrisma.authSession.findUniqueOrThrow({
      where: {
        id: fixture.sessionId,
      },
      select: {
        sessionTokenHash: true,
      },
    });

    expect(row.sessionTokenHash).toBe(
      hashSessionToken(fixture.sessionToken),
    );

    expect(row.sessionTokenHash).not.toBe(
      fixture.sessionToken,
    );
  });

  it("4B-003: database hanya menyimpan hash CSRF token", async () => {
    const row = await testPrisma.authSession.findUniqueOrThrow({
      where: {
        id: fixture.sessionId,
      },
      select: {
        csrfTokenHash: true,
      },
    });

    expect(row.csrfTokenHash).toBe(
      hashCsrfToken(fixture.csrfToken),
    );

    expect(row.csrfTokenHash).not.toBe(
      fixture.csrfToken,
    );
  });

  it("4B-004: absolute timeout tepat 12 jam", async () => {
    const row = await testPrisma.authSession.findUniqueOrThrow({
      where: {
        id: fixture.sessionId,
      },
      select: {
        createdAt: true,
        expiresAt: true,
      },
    });

    expect(
      row.expiresAt.getTime() -
        row.createdAt.getTime(),
    ).toBe(
      AUTH_CONSTANTS.SESSION_ABSOLUTE_TIMEOUT_MS,
    );
  });

  it("4B-005: validation mengembalikan tenant, teacher, role, permission", async () => {
    const result = await createService().validateSession(
      fixture.sessionToken,
    );

    expect(result).not.toBeNull();

    expect(result).toMatchObject({
      sessionId: fixture.sessionId,
      userId: fixture.userAId,
      institutionId: fixture.institutionAId,
      teacherId: fixture.teacherAId,
    });

    expect(result?.roles).toContain(
      fixture.roleName,
    );

    expect(result?.permissions).toContain(
      fixture.permissionCode,
    );
  });

  it("4B-006: token yang salah ditolak", async () => {
    await expect(
      createService().validateSession(
        "invalid-session-token",
      ),
    ).resolves.toBeNull();
  });

  it("4B-007: lastSeenAt tidak berubah sebelum 5 menit", async () => {
    const before =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: fixture.sessionId,
        },
        select: {
          lastSeenAt: true,
        },
      });

    now = plusMs(
      now,
      AUTH_CONSTANTS.LAST_SEEN_UPDATE_INTERVAL_MS - 1,
    );

    await expect(
      createService().validateSession(
        fixture.sessionToken,
      ),
    ).resolves.not.toBeNull();

    const after =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: fixture.sessionId,
        },
        select: {
          lastSeenAt: true,
        },
      });

    expect(after.lastSeenAt.getTime()).toBe(
      before.lastSeenAt.getTime(),
    );
  });

  it("4B-008: lastSeenAt diperbarui setelah mencapai 5 menit", async () => {
    now = plusMs(now, 1);

    const before =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: fixture.sessionId,
        },
        select: {
          lastSeenAt: true,
        },
      });

    await expect(
      createService().validateSession(
        fixture.sessionToken,
      ),
    ).resolves.not.toBeNull();

    const after =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: fixture.sessionId,
        },
        select: {
          lastSeenAt: true,
        },
      });

    expect(after.lastSeenAt.getTime()).toBe(
      now.getTime(),
    );

    expect(after.lastSeenAt.getTime()).toBeGreaterThan(
      before.lastSeenAt.getTime(),
    );
  });

  it("4B-009: idle timeout 2 jam ditolak", async () => {
    now = plusMs(
      now,
      AUTH_CONSTANTS.SESSION_IDLE_TIMEOUT_MS,
    );

    await expect(
      createService().validateSession(
        fixture.sessionToken,
      ),
    ).resolves.toBeNull();
  });

  it("4B-010: session revoked ditolak dan row tetap ada", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const session =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    await createService().revokeSession(
      session.sessionId,
      fixture.institutionAId,
    );

    await expect(
      createService().validateSession(
        session.sessionToken,
      ),
    ).resolves.toBeNull();

    const row =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: session.sessionId,
        },
        select: {
          revokedAt: true,
        },
      });

    expect(row.revokedAt).not.toBeNull();
  });

  it("4B-011: absolute timeout ditolak walaupun lastSeenAt masih baru", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const session =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    now = plusMs(
      now,
      AUTH_CONSTANTS.SESSION_ABSOLUTE_TIMEOUT_MS,
    );

    await expect(
      createService().validateSession(
        session.sessionToken,
      ),
    ).resolves.toBeNull();
  });

  it("4B-012: user INACTIVE ditolak walaupun session belum expired", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const session =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    await testPrisma.user.update({
      where: {
        id: fixture.userAId,
      },
      data: {
        status: "INACTIVE",
      },
    });

    await expect(
      createService().validateSession(
        session.sessionToken,
      ),
    ).resolves.toBeNull();

    await testPrisma.user.update({
      where: {
        id: fixture.userAId,
      },
      data: {
        status: "ACTIVE",
      },
    });
  });

  it("4B-013: tenant mismatch tidak dapat melakukan revoke", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const session =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    await expect(
      createService().revokeSession(
        session.sessionId,
        fixture.institutionBId,
      ),
    ).rejects.toThrow(
      "Active session not found.",
    );

    const row =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: session.sessionId,
        },
        select: {
          revokedAt: true,
        },
      });

    expect(row.revokedAt).toBeNull();
  });

  it("4B-014: user tenant B tidak dapat membuat session memakai institution A", async () => {
    await expect(
      createService().createSession({
        userId: fixture.userBId,
        institutionId: fixture.institutionAId,
      }),
    ).rejects.toThrow(
      "User not found.",
    );
  });

  it("4B-015: user INACTIVE tidak dapat membuat session", async () => {
    await testPrisma.user.update({
      where: {
        id: fixture.userAId,
      },
      data: {
        status: "INACTIVE",
      },
    });

    await expect(
      createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      }),
    ).rejects.toThrow(
      "User is not active.",
    );

    await testPrisma.user.update({
      where: {
        id: fixture.userAId,
      },
      data: {
        status: "ACTIVE",
      },
    });
  });

  it("4B-016: rotation merevoke session lama dan membuat session baru", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const old =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    now = plusMs(now, 1_000);

    const rotated =
      await createService().rotateSession(
        old.sessionToken,
        "127.0.0.2",
        "rotation-test",
      );

    expect(rotated.sessionId).not.toBe(
      old.sessionId,
    );

    expect(rotated.sessionToken).not.toBe(
      old.sessionToken,
    );

    expect(rotated.csrfToken).not.toBe(
      old.csrfToken,
    );

    await expect(
      createService().validateSession(
        old.sessionToken,
      ),
    ).resolves.toBeNull();

    await expect(
      createService().validateSession(
        rotated.sessionToken,
      ),
    ).resolves.not.toBeNull();

    const oldRow =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: old.sessionId,
        },
        select: {
          revokedAt: true,
        },
      });

    expect(oldRow.revokedAt).not.toBeNull();
  });

  it("4B-017: rotation session expired ditolak", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const old =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    now = plusMs(
      now,
      AUTH_CONSTANTS.SESSION_ABSOLUTE_TIMEOUT_MS,
    );

    await expect(
      createService().rotateSession(
        old.sessionToken,
      ),
    ).rejects.toThrow(
      "Session has expired.",
    );

    const oldRow =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: old.sessionId,
        },
        select: {
          revokedAt: true,
        },
      });

    expect(oldRow.revokedAt).toBeNull();
  });

  it("4B-018: validasi concurrent menjaga lastSeenAt tetap konsisten", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const session =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    now = plusMs(
      now,
      AUTH_CONSTANTS.LAST_SEEN_UPDATE_INTERVAL_MS,
    );

    const results = await Promise.all(
      Array.from(
        { length: 10 },
        () =>
          createService().validateSession(
            session.sessionToken,
          ),
      ),
    );

    expect(
      results.every((result) => result !== null),
    ).toBe(true);

    const row =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: session.sessionId,
        },
        select: {
          lastSeenAt: true,
        },
      });

    expect(row.lastSeenAt.getTime()).toBe(
      now.getTime(),
    );
  });

  it("4B-019: rotation atomic rollback jika CREATE session baru gagal", async () => {
    now = new Date(
      "2026-09-27T10:00:00.000Z",
    );

    const old =
      await createService().createSession({
        userId: fixture.userAId,
        institutionId: fixture.institutionAId,
      });

    const invalidIp = "X".repeat(46);

    await expect(
      createService().rotateSession(
        old.sessionToken,
        invalidIp,
        "rotation-atomic-test",
      ),
    ).rejects.toThrow();

    const oldRow =
      await testPrisma.authSession.findUniqueOrThrow({
        where: {
          id: old.sessionId,
        },
        select: {
          revokedAt: true,
        },
      });

    expect(oldRow.revokedAt).toBeNull();

    await expect(
      createService().validateSession(
        old.sessionToken,
      ),
    ).resolves.not.toBeNull();
  });
});
