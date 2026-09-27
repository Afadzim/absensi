import {
  generateCsrfToken,
  generateSessionToken,
  hashCsrfToken,
  hashSessionToken,
} from "./auth.crypto.js";
import { AUTH_CONSTANTS } from "./auth.constants.js";
import { prisma } from "../../lib/prisma.js";

export interface AuthSessionCreateInput {
  userId: string;
  institutionId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthSessionResult {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface AuthSessionValidationResult {
  sessionId: string;
  userId: string;
  institutionId: string;
  teacherId: string | null;
  roles: readonly string[];
  permissions: readonly string[];
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface AuthSessionServiceOptions {
  now?: () => Date;
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

export class AuthSessionService {
  private readonly now: () => Date;

  constructor(options: AuthSessionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createSession(
    input: AuthSessionCreateInput,
  ): Promise<AuthSessionResult> {
    const now = this.now();

    const user = await prisma.user.findFirst({
      where: {
        id: input.userId,
        institutionId: input.institutionId,
      },
      select: {
        id: true,
        institutionId: true,
        status: true,
      },
    });

    if (!user) {
      throw new Error("User not found.");
    }

    if (user.status !== "ACTIVE") {
      throw new Error("User is not active.");
    }

    const sessionToken = generateSessionToken();
    const csrfToken = generateCsrfToken();

    const sessionTokenHash = hashSessionToken(sessionToken);
    const csrfTokenHash = hashCsrfToken(csrfToken);

    const expiresAt = addMilliseconds(
      now,
      AUTH_CONSTANTS.SESSION_ABSOLUTE_TIMEOUT_MS,
    );

    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        institutionId: user.institutionId,
        sessionTokenHash,
        csrfTokenHash,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        createdIp: input.ipAddress,
        lastSeenIp: input.ipAddress,
        userAgent: input.userAgent,
      },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    });

    return {
      sessionId: session.id,
      sessionToken,
      csrfToken,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    };
  }

  async validateSession(
    sessionToken: string,
  ): Promise<AuthSessionValidationResult | null> {
    const tokenHash = hashSessionToken(sessionToken);
    const now = this.now();

    const session = await prisma.authSession.findUnique({
      where: {
        sessionTokenHash: tokenHash,
      },
      include: {
        user: {
          select: {
            id: true,
            institutionId: true,
            status: true,
            teacher: {
              select: {
                id: true,
              },
            },
            roles: {
              select: {
                role: {
                  select: {
                    name: true,
                    permissions: {
                      select: {
                        permission: {
                          select: {
                            code: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session) {
      return null;
    }

    if (session.revokedAt !== null) {
      return null;
    }

    if (now.getTime() >= session.expiresAt.getTime()) {
      return null;
    }

    if (
      now.getTime() - session.lastSeenAt.getTime() >=
      AUTH_CONSTANTS.SESSION_IDLE_TIMEOUT_MS
    ) {
      return null;
    }

    if (session.user.status !== "ACTIVE") {
      return null;
    }

    let lastSeenAt = session.lastSeenAt;

    const lastSeenThreshold = new Date(
      now.getTime() - AUTH_CONSTANTS.LAST_SEEN_UPDATE_INTERVAL_MS,
    );

    if (session.lastSeenAt.getTime() <= lastSeenThreshold.getTime()) {
      const updated = await prisma.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          lastSeenAt: {
            lte: lastSeenThreshold,
          },
        },
        data: {
          lastSeenAt: now,
        },
      });

      if (updated.count > 0) {
        lastSeenAt = now;
      } else {
        const current = await prisma.authSession.findUnique({
          where: {
            id: session.id,
          },
          select: {
            lastSeenAt: true,
          },
        });

        if (current) {
          lastSeenAt = current.lastSeenAt;
        }
      }
    }

    const roles = session.user.roles.map(
      (userRole) => userRole.role.name,
    );

    const permissions = [
      ...new Set(
        session.user.roles.flatMap((userRole) =>
          userRole.role.permissions.map(
            (rolePermission) => rolePermission.permission.code,
          ),
        ),
      ),
    ];

    return {
      sessionId: session.id,
      userId: session.user.id,
      institutionId: session.user.institutionId,
      teacherId: session.user.teacher?.id ?? null,
      roles,
      permissions,
      createdAt: session.createdAt,
      lastSeenAt,
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(
    sessionId: string,
    institutionId: string,
  ): Promise<void> {
    const now = this.now();

    const result = await prisma.authSession.updateMany({
      where: {
        id: sessionId,
        institutionId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    if (result.count === 0) {
      throw new Error("Active session not found.");
    }
  }

  async rotateSession(
    sessionToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthSessionResult> {
    const tokenHash = hashSessionToken(sessionToken);
    const now = this.now();

    return prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({
        where: {
          sessionTokenHash: tokenHash,
        },
        include: {
          user: {
            select: {
              id: true,
              institutionId: true,
              status: true,
            },
          },
        },
      });

      if (!session) {
        throw new Error("Session not found.");
      }

      if (session.revokedAt !== null) {
        throw new Error("Session is revoked.");
      }

      if (now.getTime() >= session.expiresAt.getTime()) {
        throw new Error("Session has expired.");
      }

      if (
        now.getTime() - session.lastSeenAt.getTime() >=
        AUTH_CONSTANTS.SESSION_IDLE_TIMEOUT_MS
      ) {
        throw new Error("Session is idle-expired.");
      }

      if (session.user.status !== "ACTIVE") {
        throw new Error("User is not active.");
      }

      await tx.authSession.update({
        where: {
          id: session.id,
        },
        data: {
          revokedAt: now,
        },
      });

      const newSessionToken = generateSessionToken();
      const newCsrfToken = generateCsrfToken();

      const newSession = await tx.authSession.create({
        data: {
          userId: session.user.id,
          institutionId: session.user.institutionId,
          sessionTokenHash: hashSessionToken(newSessionToken),
          csrfTokenHash: hashCsrfToken(newCsrfToken),
          createdAt: now,
          lastSeenAt: now,
          expiresAt: addMilliseconds(
            now,
            AUTH_CONSTANTS.SESSION_ABSOLUTE_TIMEOUT_MS,
          ),
          createdIp: ipAddress,
          lastSeenIp: ipAddress,
          userAgent,
        },
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
        },
      });

      return {
        sessionId: newSession.id,
        sessionToken: newSessionToken,
        csrfToken: newCsrfToken,
        createdAt: newSession.createdAt,
        lastSeenAt: newSession.lastSeenAt,
        expiresAt: newSession.expiresAt,
      };
    });
  }
}
