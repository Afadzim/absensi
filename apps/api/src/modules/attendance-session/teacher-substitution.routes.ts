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
  TeacherSubstitutionConflictError,
  TeacherSubstitutionInputError,
  TeacherSubstitutionNotFoundError,
  TeacherSubstitutionService,
} from "./teacher-substitution.service.js";
import { TEACHER_SUBSTITUTION_PERMISSIONS } from "./teacher-substitution.permissions.js";

interface RouteOptions {
  service: TeacherSubstitutionService;
  authSessionService: AuthSessionService;
}

interface ScheduleParams {
  scheduleId: string;
}

interface SubstitutionParams {
  id: string;
}

interface SubstitutionQuery {
  page?: string;
  pageSize?: string;
  substitutionDate?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TeacherSubstitutionInputError(
      "Request body must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function assertFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(body).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new TeacherSubstitutionInputError(
      `Unknown field: ${unknown.join(", ")}`,
    );
  }
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TeacherSubstitutionInputError(
      `${field} must use YYYY-MM-DD format.`,
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new TeacherSubstitutionInputError(
      `${field} must be a valid calendar date.`,
    );
  }
  return date;
}

function parseTime(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/u.test(value)) {
    throw new TeacherSubstitutionInputError(
      `${field} must use HH:mm 24-hour format.`,
    );
  }
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) {
    throw new TeacherSubstitutionInputError(
      `${field} must be a valid time.`,
    );
  }
  return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

function parseText(
  value: unknown,
  field: string,
  maxLength: number,
  required: boolean,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    throw new TeacherSubstitutionInputError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new TeacherSubstitutionInputError(
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new TeacherSubstitutionInputError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parsePage(value: string | undefined, field: string, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new TeacherSubstitutionInputError(
      `${field} must be a positive integer.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TeacherSubstitutionInputError(
      `${field} must be a positive integer.`,
    );
  }
  return parsed;
}

function auditContext(request: FastifyRequest) {
  const auth = request.auth;
  if (!auth) throw new Error("AuthContext missing after permission check.");
  return {
    auth,
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new Error("AuthContext missing after permission check.");
  return request.auth;
}

function parseCreateBody(value: unknown) {
  const body = objectBody(value);
  assertFields(body, [
    "substituteTeacherId",
    "substitutionDate",
    "startTime",
    "endTime",
    "reason",
    "auditReason",
  ]);
  if (
    typeof body.substituteTeacherId !== "string" ||
    !UUID_PATTERN.test(body.substituteTeacherId)
  ) {
    throw new TeacherSubstitutionInputError(
      "substituteTeacherId must be a valid UUID.",
    );
  }
  const reason = parseText(body.reason, "reason", 2000, true);
  if (!reason) {
    throw new TeacherSubstitutionInputError("reason is required.");
  }
  return {
    data: {
      substituteTeacherId: body.substituteTeacherId,
      substitutionDate: parseDate(
        body.substitutionDate,
        "substitutionDate",
      ),
      startTime: parseTime(body.startTime, "startTime"),
      endTime: parseTime(body.endTime, "endTime"),
      reason,
    },
    auditReason: parseText(body.auditReason, "auditReason", 2000, false),
  };
}

function parseTransitionBody(value: unknown) {
  if (value === undefined) return undefined;
  const body = objectBody(value);
  assertFields(body, ["auditReason"]);
  return parseText(body.auditReason, "auditReason", 2000, false);
}

function sendKnownError(reply: FastifyReply, error: unknown) {
  if (error instanceof TeacherSubstitutionInputError) {
    return reply.status(400).send({
      error: { code: "BAD_REQUEST", message: error.message },
    });
  }
  if (error instanceof TeacherSubstitutionNotFoundError) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: error.message },
    });
  }
  if (error instanceof TeacherSubstitutionConflictError) {
    return reply.status(409).send({
      error: { code: "SUBSTITUTION_CONFLICT", message: error.message },
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2003", "P2004"].includes(error.code)) {
      return reply.status(409).send({
        error: {
          code: "SUBSTITUTION_CONFLICT",
          message:
            "The substitution overlaps another active request or conflicts with existing data.",
        },
      });
    }
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23P01"
  ) {
    return reply.status(409).send({
      error: {
        code: "SUBSTITUTION_CONFLICT",
        message: "Active substitution intervals must not overlap.",
      },
    });
  }
  throw error;
}

export async function registerTeacherSubstitutionRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const authorizeRead = createRequirePermission(
    options.authSessionService,
    TEACHER_SUBSTITUTION_PERMISSIONS.read,
  );
  const authorizeCreate = createRequirePermission(
    options.authSessionService,
    TEACHER_SUBSTITUTION_PERMISSIONS.create,
  );
  const authorizeApprove = createRequirePermission(
    options.authSessionService,
    TEACHER_SUBSTITUTION_PERMISSIONS.approve,
  );
  const authorizeCancel = createRequirePermission(
    options.authSessionService,
    TEACHER_SUBSTITUTION_PERMISSIONS.cancel,
  );

  app.get<{
    Params: ScheduleParams;
    Querystring: SubstitutionQuery;
  }>(
    "/api/v1/schedules/:scheduleId/substitutions",
    { preHandler: authorizeRead },
    async (request, reply) => {
      try {
        const page = parsePage(request.query.page, "page", 1);
        const pageSize = parsePage(request.query.pageSize, "pageSize", 50);
        if (pageSize > 100) {
          throw new TeacherSubstitutionInputError(
            "pageSize must be between 1 and 100.",
          );
        }
        const result = await options.service.list(
          requireAuth(request).institutionId,
          requireUuid(request.params.scheduleId, "scheduleId"),
          {
            page,
            pageSize,
            substitutionDate:
              request.query.substitutionDate === undefined
                ? undefined
                : parseDate(
                    request.query.substitutionDate,
                    "substitutionDate",
                  ),
          },
        );
        return reply.status(200).send({
          data: result.data,
          pagination: { page, pageSize, total: result.total },
        });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: ScheduleParams }>(
    "/api/v1/schedules/:scheduleId/substitutions",
    { preHandler: authorizeCreate },
    async (request, reply) => {
      try {
        const parsed = parseCreateBody(request.body);
        const row = await options.service.create(
          auditContext(request),
          requireUuid(request.params.scheduleId, "scheduleId"),
          parsed.data,
          parsed.auditReason,
        );
        return reply.status(201).send({ data: row });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: SubstitutionParams }>(
    "/api/v1/substitutions/:id/approve",
    { preHandler: authorizeApprove },
    async (request, reply) => {
      try {
        const auditReason = parseTransitionBody(request.body);
        const row = await options.service.approve(
          auditContext(request),
          requireUuid(request.params.id, "id"),
          auditReason,
        );
        return reply.status(200).send({ data: row });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: SubstitutionParams }>(
    "/api/v1/substitutions/:id/reject",
    { preHandler: authorizeApprove },
    async (request, reply) => {
      try {
        const auditReason = parseTransitionBody(request.body);
        const row = await options.service.reject(
          auditContext(request),
          requireUuid(request.params.id, "id"),
          auditReason,
        );
        return reply.status(200).send({ data: row });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: SubstitutionParams }>(
    "/api/v1/substitutions/:id/cancel",
    { preHandler: authorizeCancel },
    async (request, reply) => {
      try {
        const auditReason = parseTransitionBody(request.body);
        const row = await options.service.cancel(
          auditContext(request),
          requireUuid(request.params.id, "id"),
          auditReason,
        );
        return reply.status(200).send({ data: row });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );
}
