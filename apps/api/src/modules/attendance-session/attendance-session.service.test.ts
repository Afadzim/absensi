import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttendanceSessionService } from "./attendance-session.service.js";
import {
  createAttendanceSessionFixture,
  type AttendanceSessionFixture,
} from "./attendance-session.test.fixture.js";
import { closeTestDb, testPrisma } from "../../test/db.js";

const service = new AttendanceSessionService();

let fixture: AttendanceSessionFixture;
let tenantBFixture: AttendanceSessionFixture;

beforeAll(async () => {
  fixture = await createAttendanceSessionFixture();
  tenantBFixture = await createAttendanceSessionFixture();
});

afterAll(async () => {
  await tenantBFixture?.cleanup();
  await fixture?.cleanup();
  await closeTestDb();
});

describe("AttendanceSessionService.withSessionTransaction", () => {
  it("AS-001: runs the callback with the tenant-scoped session", async () => {
    let callbackRun = false;

    const result = await service.withSessionTransaction(
      fixture.institutionId,
      fixture.sessionId,
      async (tx, session) => {
        callbackRun = true;
        expect(tx).toBeDefined();
        return {
          sessionId: session.id,
          institutionId: session.institutionId,
          status: session.status,
        };
      },
    );

    expect(callbackRun).toBe(true);
    expect(result).toEqual({
      sessionId: fixture.sessionId,
      institutionId: fixture.institutionId,
      status: "OPEN",
    });
  });

  it("AS-002: rejects an unknown session and never runs the callback", async () => {
    let callbackRun = false;
    const unknownSessionId = "00000000-0000-0000-0000-000000000001";

    await expect(
      service.withSessionTransaction(
        fixture.institutionId,
        unknownSessionId,
        async () => {
          callbackRun = true;
          return "must-not-run";
        },
      ),
    ).rejects.toThrow("AttendanceSession not found");

    expect(callbackRun).toBe(false);
  });

  it("AS-003: enforces tenant isolation", async () => {
    let callbackRun = false;

    await expect(
      service.withSessionTransaction(
        tenantBFixture.institutionId,
        fixture.sessionId,
        async () => {
          callbackRun = true;
          return "must-not-run";
        },
      ),
    ).rejects.toThrow("AttendanceSession not found");

    expect(callbackRun).toBe(false);

    const sessionInTenantA = await testPrisma.attendanceSession.findUnique({
      where: { id: fixture.sessionId },
      select: { institutionId: true, status: true },
    });

    expect(sessionInTenantA).toEqual({
      institutionId: fixture.institutionId,
      status: "OPEN",
    });
  });

  it("AS-004: rolls back callback mutations when the callback throws", async () => {
    const before = await testPrisma.attendanceSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
      select: { status: true },
    });

    expect(before.status).toBe("OPEN");

    await expect(
      service.withSessionTransaction(
        fixture.institutionId,
        fixture.sessionId,
        async (tx) => {
          await tx.attendanceSession.update({
            where: { id: fixture.sessionId },
            data: {
              status: "FINALIZED",
              finalizedAt: new Date(),
            },
          });

          throw new Error("FORCE_ROLLBACK");
        },
      ),
    ).rejects.toThrow("FORCE_ROLLBACK");

    const after = await testPrisma.attendanceSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
      select: { status: true },
    });

    expect(after.status).toBe("OPEN");
  });

  it("AS-005: commits callback mutations when the callback succeeds", async () => {
    await service.withSessionTransaction(
      fixture.institutionId,
      fixture.sessionId,
      async (tx) => {
        await tx.attendanceSession.update({
          where: { id: fixture.sessionId },
          data: {
            status: "FINALIZED",
            finalizedAt: new Date(),
          },
        });

        return "COMMITTED";
      },
    );

    const after = await testPrisma.attendanceSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
      select: { status: true },
    });

    expect(after.status).toBe("FINALIZED");
  });
});
