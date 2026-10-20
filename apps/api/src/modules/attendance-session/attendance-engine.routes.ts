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
  AttendanceConflictError,
  AttendanceEngineService,
  AttendanceInputError,
  AttendanceNotFoundError,
  type AttendanceAuditContext,
  type GateCheckInInput,
  type StudentAdministrativeStatusInput,
  type StudentAdministrativeStatusType,
} from "./attendance-engine.service.js";
import { ATTENDANCE_ENGINE_PERMISSIONS } from "./attendance-engine.permissions.js";

interface RouteOptions {
  service: AttendanceEngineService;
  authSessionService: AuthSessionService;
}

interface SessionParams {
  sessionId: string;
}

interface StatusParams {
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AttendanceInputError("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function assertFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(body).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new AttendanceInputError(`Unknown field: ${unknown.join(", ")}`);
  }
}

function parseUuid(
  body: Record<string, unknown>,
  field: string,
  required = true,
): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AttendanceInputError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseDate(
  body: Record<string, unknown>,
  field: string,
  required = true,
): Date | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new AttendanceInputError(`${field} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new AttendanceInputError(`${field} must be a valid calendar date.`);
  }
  return date;
}

function parseDateTime(body: Record<string, unknown>, field: string): Date {
  const value = body[field];
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/u.test(value)) {
    throw new AttendanceInputError(`${field} must be an ISO datetime.`);
  }
  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  const date = new Date(value);
  if (
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10) ||
    Number.isNaN(date.getTime())
  ) {
    throw new AttendanceInputError(`${field} must be a valid ISO datetime.`);
  }
  return date;
}

function parseText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  required: boolean,
): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    throw new AttendanceInputError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new AttendanceInputError(
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function parseGateEvent(value: unknown): GateCheckInInput {
  const body = objectBody(value);
  assertFields(body, ["studentId", "eventAt", "clientEventId", "source"]);
  const studentId = parseUuid(body, "studentId");
  const clientEventId = parseText(body, "clientEventId", 100, true);
  const source = parseText(body, "source", 50, false);
  if (!studentId || !clientEventId) {
    throw new AttendanceInputError("studentId and clientEventId are required.");
  }
  return {
    studentId,
    eventAt: parseDateTime(body, "eventAt"),
    clientEventId,
    source,
  };
}

function parseAdministrativeStatus(
  value: unknown,
  operation: "create" | "update",
): {
  data: StudentAdministrativeStatusInput;
  auditReason?: string;
} {
  const body = objectBody(value);
  assertFields(body, [
    "studentId",
    "type",
    "validFrom",
    "validTo",
    "reason",
    "auditReason",
  ]);
  const required = operation === "create";
  const studentId = parseUuid(body, "studentId", required);
  const typeValue = body.type;
  const typeOptions: readonly StudentAdministrativeStatusType[] = [
    "IZIN",
    "SAKIT",
    "PENUGASAN",
  ];
  if (
    typeValue !== undefined &&
    (typeof typeValue !== "string" ||
      !typeOptions.includes(typeValue as StudentAdministrativeStatusType))
  ) {
    throw new AttendanceInputError(
      `type must be one of: ${typeOptions.join(", ")}.`,
    );
  }
  if (required && typeValue === undefined) {
    throw new AttendanceInputError("type is required.");
  }
  const validFrom = parseDate(body, "validFrom", required);
  const validTo =
    body.validTo === null
      ? null
      : parseDate(body, "validTo", false);
  if (
    validFrom &&
    validTo instanceof Date &&
    validTo < validFrom
  ) {
    throw new AttendanceInputError("validTo must be on or after validFrom.");
  }
  if (
    body.reason !== undefined &&
    body.reason !== null &&
    typeof body.reason !== "string"
  ) {
    throw new AttendanceInputError("reason must be a string or null.");
  }
  const reason =
    typeof body.reason === "string" ? body.reason.trim() : body.reason;
  if (typeof reason === "string" && reason.length > 2000) {
    throw new AttendanceInputError("reason must be at most 2000 characters.");
  }
  const auditReason = parseText(body, "auditReason", 2000, false);
  return {
    data: {
      studentId,
      type: typeValue as StudentAdministrativeStatusType | undefined,
      validFrom,
      validTo,
      reason,
    },
    auditReason,
  };
}

function requireParamUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new AttendanceInputError(`${field} must be a valid UUID.`);
  }
  return value;
}

function auditContext(request: FastifyRequest): AttendanceAuditContext {
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

function sendKnownError(reply: FastifyReply, error: unknown) {
  if (error instanceof AttendanceInputError) {
    return reply.status(400).send({
      error: { code: "BAD_REQUEST", message: error.message },
    });
  }
  if (error instanceof AttendanceNotFoundError) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: error.message },
    });
  }
  if (error instanceof AttendanceConflictError) {
    return reply.status(409).send({
      error: { code: "ATTENDANCE_CONFLICT", message: error.message },
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2004") {
      return reply.status(409).send({
        error: {
          code: "ATTENDANCE_CONFLICT",
          message: "The attendance event conflicts with existing data.",
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
        code: "ATTENDANCE_CONFLICT",
        message: "Student administrative status dates must not overlap.",
      },
    });
  }
  throw error;
}

export async function registerAttendanceEngineRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const authorizeGateCheckIn = createRequirePermission(
    options.authSessionService,
    ATTENDANCE_ENGINE_PERMISSIONS.gateCheckIn,
  );
  const authorizeRosterRead = createRequirePermission(
    options.authSessionService,
    ATTENDANCE_ENGINE_PERMISSIONS.studentRosterRead,
  );
  const authorizeStudentMark = createRequirePermission(
    options.authSessionService,
    ATTENDANCE_ENGINE_PERMISSIONS.studentMark,
  );
  const authorizeAdminStatusCreate = createRequirePermission(
    options.authSessionService,
    ATTENDANCE_ENGINE_PERMISSIONS.studentAdministrativeStatusCreate,
  );
  const authorizeAdminStatusUpdate = createRequirePermission(
    options.authSessionService,
    ATTENDANCE_ENGINE_PERMISSIONS.studentAdministrativeStatusUpdate,
  );

  app.post("/api/v1/gate-events/check-in", {
    preHandler: authorizeGateCheckIn,
  }, async (request, reply) => {
    try {
      const result = await options.service.createGateCheckIn(
        auditContext(request),
        parseGateEvent(request.body),
      );
      return reply.status(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      return sendKnownError(reply, error);
    }
  });

  app.get<{ Params: SessionParams }>(
    "/api/v1/attendance-sessions/:sessionId/student-roster",
    { preHandler: authorizeRosterRead },
    async (request, reply) => {
      try {
        const sessionId = requireParamUuid(request.params.sessionId, "sessionId");
        const roster = await options.service.getStudentRoster(
          requireAuth(request).institutionId,
          sessionId,
        );
        return reply.status(200).send({ data: roster });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: SessionParams }>(
    "/api/v1/attendance-sessions/:sessionId/student-attendance",
    { preHandler: authorizeStudentMark },
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (!auth.teacherId) {
          return reply.status(403).send({
            error: {
              code: "TEACHER_PROFILE_REQUIRED",
              message: "An associated teacher profile is required.",
            },
          });
        }
        const body = objectBody(request.body);
        assertFields(body, ["studentId"]);
        const studentId = parseUuid(body, "studentId");
        if (!studentId) {
          throw new AttendanceInputError("studentId is required.");
        }
        const result = await options.service.markStudentPresent(
          auditContext(request),
          requireParamUuid(request.params.sessionId, "sessionId"),
          studentId,
          auth.teacherId,
        );
        return reply.status(200).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post("/api/v1/student-administrative-statuses", {
    preHandler: authorizeAdminStatusCreate,
  }, async (request, reply) => {
    try {
      const parsed = parseAdministrativeStatus(request.body, "create");
      const data = parsed.data;
      if (!data.studentId || !data.type || !data.validFrom) {
        throw new AttendanceInputError(
          "studentId, type, and validFrom are required.",
        );
      }
      const result = await options.service.createStudentAdministrativeStatus(
        auditContext(request),
        {
          studentId: data.studentId,
          type: data.type,
          validFrom: data.validFrom,
          validTo: data.validTo,
          reason: data.reason,
        },
        parsed.auditReason,
      );
      return reply.status(201).send({ data: result });
    } catch (error) {
      return sendKnownError(reply, error);
    }
  });

  app.patch<{ Params: StatusParams }>(
    "/api/v1/student-administrative-statuses/:id",
    { preHandler: authorizeAdminStatusUpdate },
    async (request, reply) => {
      try {
        const id = requireParamUuid(request.params.id, "id");
        const parsed = parseAdministrativeStatus(request.body, "update");
        const result = await options.service.updateStudentAdministrativeStatus(
          auditContext(request),
          id,
          parsed.data,
          parsed.auditReason,
        );
        if (!result) {
          return reply.status(404).send({
            error: {
              code: "NOT_FOUND",
              message: "Student administrative status not found.",
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
