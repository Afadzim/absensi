import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  AttendanceSessionService,
} from "./attendance-session.service.js";

type ContextHeaders = {
  "x-institution-id"?: string;
  "x-teacher-id"?: string;
};

type CreateSessionBody = {
  scheduleId?: unknown;
  sessionDate?: unknown;
};

type SessionParams = {
  sessionId: string;
};

function requireHeader(
  request: FastifyRequest<{
    Headers: ContextHeaders;
  }>,
  name: keyof ContextHeaders,
): string {
  const value = request.headers[name];

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new HttpRequestError(
      400,
      `Missing required header: ${name}`,
    );
  }

  return value.trim();
}

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
): Promise<void> {
  app.post<{
    Headers: ContextHeaders;
    Body: CreateSessionBody;
  }>(
    "/api/v1/attendance-sessions",
    async (request, reply) => {
      try {
        const institutionId = requireUuid(
          requireHeader(
            request,
            "x-institution-id",
          ),
          "x-institution-id",
        );

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
            institutionId,
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
    Headers: ContextHeaders;
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/open",
    async (request, reply) => {
      try {
        const institutionId = requireUuid(
          requireHeader(
            request,
            "x-institution-id",
          ),
          "x-institution-id",
        );

        const teacherId = requireUuid(
          requireHeader(
            request,
            "x-teacher-id",
          ),
          "x-teacher-id",
        );

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.openSegment({
            institutionId,
            sessionId,
            teacherId,
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
    Headers: ContextHeaders;
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/handover",
    async (request, reply) => {
      try {
        const institutionId = requireUuid(
          requireHeader(
            request,
            "x-institution-id",
          ),
          "x-institution-id",
        );

        const teacherId = requireUuid(
          requireHeader(
            request,
            "x-teacher-id",
          ),
          "x-teacher-id",
        );

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.handover({
            institutionId,
            sessionId,
            teacherId,
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
    Headers: ContextHeaders;
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/finalize",
    async (request, reply) => {
      try {
        const institutionId = requireUuid(
          requireHeader(
            request,
            "x-institution-id",
          ),
          "x-institution-id",
        );

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.finalize({
            institutionId,
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
    Headers: ContextHeaders;
    Params: SessionParams;
  }>(
    "/api/v1/attendance-sessions/:sessionId/cancel",
    async (request, reply) => {
      try {
        const institutionId = requireUuid(
          requireHeader(
            request,
            "x-institution-id",
          ),
          "x-institution-id",
        );

        const sessionId = requireUuid(
          request.params.sessionId,
          "sessionId",
        );

        const result =
          await service.cancel({
            institutionId,
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