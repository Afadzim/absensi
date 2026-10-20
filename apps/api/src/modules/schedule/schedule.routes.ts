import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { Prisma } from "../../../generated/prisma/client.js";
import type { AuthContext } from "../auth/auth.context.js";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import { createRequirePermission } from "../auth/auth.middleware.js";
import {
  ScheduleConflictError,
  ScheduleNotFoundError,
  ScheduleService,
  type ScheduleFilters,
} from "./schedule.service.js";
import {
  isValidUuid,
  ScheduleInputError,
  SCHEDULE_PERMISSIONS,
} from "./schedule.validation.js";

interface ScheduleRouteOptions {
  service: ScheduleService;
  authSessionService: AuthSessionService;
}

interface ScheduleParams {
  id: string;
  participantId?: string;
}

interface ScheduleQuery {
  page?: string;
  pageSize?: string;
  academicYearId?: string;
  semesterId?: string;
  dayOfWeek?: string;
}

function parsePositiveInteger(
  value: string | undefined,
  field: string,
  defaultValue?: number,
): number {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (!value || !/^\d+$/u.test(value)) {
    throw new ScheduleInputError(`${field} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ScheduleInputError(`${field} must be a positive integer.`);
  }
  return parsed;
}

function parseFilters(query: ScheduleQuery): ScheduleFilters {
  const page = parsePositiveInteger(query.page, "page", 1);
  const pageSize = parsePositiveInteger(query.pageSize, "pageSize", 50);
  if (pageSize > 100) {
    throw new ScheduleInputError("pageSize must be between 1 and 100.");
  }
  if (
    query.academicYearId !== undefined &&
    !isValidUuid(query.academicYearId)
  ) {
    throw new ScheduleInputError("academicYearId must be a valid UUID.");
  }
  if (query.semesterId !== undefined && !isValidUuid(query.semesterId)) {
    throw new ScheduleInputError("semesterId must be a valid UUID.");
  }
  const dayOfWeek =
    query.dayOfWeek === undefined
      ? undefined
      : parsePositiveInteger(query.dayOfWeek, "dayOfWeek");
  if (dayOfWeek !== undefined && dayOfWeek > 7) {
    throw new ScheduleInputError(
      "dayOfWeek must be between 1 and 7 (Monday=1, Sunday=7).",
    );
  }
  return {
    page,
    pageSize,
    academicYearId: query.academicYearId,
    semesterId: query.semesterId,
    dayOfWeek,
  };
}

function requireId(value: string, field: string): string {
  if (!isValidUuid(value)) {
    throw new ScheduleInputError(`${field} must be a valid UUID.`);
  }
  return value;
}

function auditContext(request: FastifyRequest) {
  const auth = request.auth;
  if (!auth) {
    throw new Error("AuthContext missing after permission check.");
  }
  return {
    auth,
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new Error("AuthContext missing after permission check.");
  }
  return request.auth;
}

function sendKnownError(reply: FastifyReply, error: unknown) {
  if (error instanceof ScheduleInputError) {
    return reply.status(400).send({
      error: { code: "BAD_REQUEST", message: error.message },
    });
  }
  if (error instanceof ScheduleNotFoundError) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: error.message },
    });
  }
  if (error instanceof ScheduleConflictError) {
    return reply.status(409).send({
      error: { code: "SCHEDULE_CONFLICT", message: error.message },
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2003" || error.code === "P2004") {
      return reply.status(409).send({
        error: {
          code: "SCHEDULE_CONFLICT",
          message: "The schedule change conflicts with existing data.",
        },
      });
    }
  }
  throw error;
}

export async function registerScheduleRoutes(
  app: FastifyInstance,
  options: ScheduleRouteOptions,
): Promise<void> {
  const authorizeRead = createRequirePermission(
    options.authSessionService,
    SCHEDULE_PERMISSIONS.read,
  );
  const authorizeCreate = createRequirePermission(
    options.authSessionService,
    SCHEDULE_PERMISSIONS.create,
  );
  const authorizeUpdate = createRequirePermission(
    options.authSessionService,
    SCHEDULE_PERMISSIONS.update,
  );

  app.get<{ Querystring: ScheduleQuery }>(
    "/api/v1/schedules",
    { preHandler: authorizeRead },
    async (request, reply) => {
      try {
        const filters = parseFilters(request.query);
        const result = await options.service.list(
          requireAuth(request).institutionId,
          filters,
        );
        return reply.status(200).send({
          data: result.data,
          pagination: {
            page: filters.page,
            pageSize: filters.pageSize,
            total: result.total,
          },
        });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.get<{ Params: ScheduleParams }>(
    "/api/v1/schedules/:id",
    { preHandler: authorizeRead },
    async (request, reply) => {
      try {
        const id = requireId(request.params.id, "id");
        const result = await options.service.get(
          requireAuth(request).institutionId,
          id,
        );
        if (!result) {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: "Schedule not found." },
          });
        }
        return reply.status(200).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post(
    "/api/v1/schedules",
    { preHandler: authorizeCreate },
    async (request, reply) => {
      try {
        const result = await options.service.create(
          auditContext(request),
          request.body,
        );
        return reply.status(201).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.patch<{ Params: ScheduleParams }>(
    "/api/v1/schedules/:id",
    { preHandler: authorizeUpdate },
    async (request, reply) => {
      try {
        const id = requireId(request.params.id, "id");
        const result = await options.service.update(
          auditContext(request),
          id,
          request.body,
        );
        if (!result) {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: "Schedule not found." },
          });
        }
        return reply.status(200).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: ScheduleParams }>(
    "/api/v1/schedules/:id/student-participants",
    { preHandler: authorizeCreate },
    async (request, reply) => {
      try {
        const scheduleId = requireId(request.params.id, "id");
        const result = await options.service.createStudentParticipant(
          auditContext(request),
          scheduleId,
          request.body,
        );
        return reply.status(201).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.patch<{ Params: ScheduleParams }>(
    "/api/v1/schedules/:id/student-participants/:participantId",
    { preHandler: authorizeUpdate },
    async (request, reply) => {
      try {
        const scheduleId = requireId(request.params.id, "id");
        const participantId = requireId(
          request.params.participantId ?? "",
          "participantId",
        );
        const result = await options.service.updateStudentParticipant(
          auditContext(request),
          scheduleId,
          participantId,
          request.body,
        );
        if (!result) {
          return reply.status(404).send({
            error: {
              code: "NOT_FOUND",
              message: "Schedule participant override not found.",
            },
          });
        }
        return reply.status(200).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );
}
