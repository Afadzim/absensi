import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  AttendanceSessionService,
} from "./attendance-session.service.js";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import { AUTH_PERMISSIONS } from "../auth/auth.permissions.js";
import { createRequirePermission } from "../auth/auth.middleware.js";

type CreateSessionBody = {
  scheduleId?: unknown;
  sessionDate?: unknown;
};

type SessionParams = {
  sessionId: string;
};

function requireUuid(
  value: string,
  fieldName: string,
): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(value)) {
    throw new HttpRequestError(
      400,
      `${fieldName} must be a valid UUID`,
    );
  }

  return value;
}

function requireDate(
  value: unknown,
  fieldName: string,
): Date {
  if (typeof value !== "string") {
    throw new HttpRequestError(
      400,
      `${fieldName} must be an ISO datetime string`,
    );
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpRequestError(
      400,
      `${fieldName} must be a valid ISO datetime`,
    );
  }

  return parsed;
}

class HttpRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

function sendDomainError(
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof HttpRequestError) {
    return reply.status(error.statusCode).send({
      error: {
        code: "BAD_REQUEST",
        message: error.message,
      },
    });
  }

  const message =
    error instanceof Error
      ? error.message
      : "Unexpected error";

  if (
    message === "Schedule not found" ||
    message === "AttendanceSession not found"
  ) {
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message,
      },
    });
  }

  if (
    message ===
    "Schedule relation data is incomplete"
  ) {
    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Schedule relation data is incomplete",
      },
    });
  }

  return reply.status(409).send({
    error: {
      code: "ATTENDANCE_SESSION_CONFLICT",
      message,
    },
  });
}

export async function registerAttendanceSessionRoutes(
  app: FastifyInstance,
  service: AttendanceSessionService,
  authSessionService: AuthSessionService,
): Promise<void> {
  const authorizeCreate = createRequirePermission(
    authSessionService,
    AUTH_PERMISSIONS.attendanceSessionCreate,
  );
  const authorizeOpen = createRequirePermission(
    authSessionService,
    AUTH_PERMISSIONS.attendanceSessionOpen,
  );
  const authorizeHandover = createRequirePermission(
    authSessionService,
    AUTH_PERMISSIONS.attendanceSessionHandover,
  );
  const authorizeFinalize = createRequirePermission(
    authSessionService,
    AUTH_PERMISSIONS.attendanceSessionFinalize,
  );
  const authorizeCancel = createRequirePermission(
    authSessionService,
    AUTH_PERMISSIONS.attendanceSessionCancel,
  );

  app.post<{
    Body: CreateSessionBody;
  }>(
    "/api/v1/attendance-sessions",
    {
      preHandler: authorizeCreate,
    },
    async (request, reply) => {
      try {
        const auth = request.auth;

        if (!auth) {
          return reply.status(401).send({
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication required.",
            },
          });
        }

        const body = request.body ?? {};

        const scheduleId = requireUuid(
          typeof body.scheduleId === "string"
            ? body.scheduleId
            : "",
          "scheduleId",
        );

        const sessionDate = requireDate(
          body.sessionDate,
          "sessionDate",
        );

        const result =
          await service.createSession({
            institutionId: auth.institutionId,
            scheduleId,
            sessionDate,
          });

        return reply.status(201).send({
          data: result,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post<{
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/open",
    {
      preHandler: authorizeOpen,
    },
    async (request, reply) => {
      try {
        const auth = request.auth;

        if (!auth) {
          return reply.status(401).send({
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication required.",
            },
          });
        }

        if (!auth.teacherId) {
          return reply.status(403).send({
            error: {
              code: "TEACHER_PROFILE_REQUIRED",
              message: "An associated teacher profile is required.",
            },
          });
        }

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.openSegment({
            institutionId: auth.institutionId,
            sessionId,
            teacherId: auth.teacherId,
            startedAt: new Date(),
          });

        return reply.status(200).send({
          data: result,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post<{
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/handover",
    {
      preHandler: authorizeHandover,
    },
    async (request, reply) => {
      try {
        const auth = request.auth;

        if (!auth) {
          return reply.status(401).send({
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication required.",
            },
          });
        }

        if (!auth.teacherId) {
          return reply.status(403).send({
            error: {
              code: "TEACHER_PROFILE_REQUIRED",
              message: "An associated teacher profile is required.",
            },
          });
        }

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.handover({
            institutionId: auth.institutionId,
            sessionId,
            teacherId: auth.teacherId,
            handoverAt: new Date(),
          });

        return reply.status(200).send({
          data: result,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post<{
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/finalize",
    {
      preHandler: authorizeFinalize,
    },
    async (request, reply) => {
      try {
        const auth = request.auth;

        if (!auth) {
          return reply.status(401).send({
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication required.",
            },
          });
        }

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.finalize({
            institutionId: auth.institutionId,
            sessionId,
            finalizedAt: new Date(),
          });

        return reply.status(200).send({
          data: result,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post<{
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/cancel",
    {
      preHandler: authorizeCancel,
    },
    async (request, reply) => {
      try {
        const auth = request.auth;

        if (!auth) {
          return reply.status(401).send({
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication required.",
            },
          });
        }

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.cancel({
            institutionId: auth.institutionId,
            sessionId,
            cancelledAt: new Date(),
          });

        return reply.status(200).send({
          data: result,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}