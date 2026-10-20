import { Prisma } from "../../../generated/prisma/client.js";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { AuthContext } from "../auth/auth.context.js";
import { createRequirePermission } from "../auth/auth.middleware.js";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import {
  Phase8ConflictError,
  Phase8NotFoundError,
  Phase8Service,
} from "./phase8.service.js";
import {
  parseCalendarDayInput,
  parseReportRange,
  Phase8InputError,
  systemEffectiveDate,
} from "./phase8.validation.js";
import { PHASE8_PERMISSIONS } from "./phase8.permissions.js";

interface RouteOptions {
  service: Phase8Service;
  authSessionService: AuthSessionService;
}

interface CalendarQuery {
  startDate?: string;
  endDate?: string;
}

interface IdParams {
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new Error("AuthContext missing after permission check.");
  }
  return request.auth;
}

function auditContext(request: FastifyRequest) {
  return {
    auth: requireAuth(request),
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

function parseUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Phase8InputError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseRange(query: CalendarQuery) {
  if (query.startDate === undefined || query.endDate === undefined) {
    throw new Phase8InputError("startDate and endDate are required.");
  }
  return parseReportRange(
    query.startDate,
    query.endDate,
    systemEffectiveDate(),
  );
}

function sendKnownError(reply: FastifyReply, error: unknown) {
  if (error instanceof Phase8InputError) {
    return reply.status(400).send({
      error: { code: "BAD_REQUEST", message: error.message },
    });
  }
  if (error instanceof Phase8NotFoundError) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: error.message },
    });
  }
  if (error instanceof Phase8ConflictError) {
    return reply.status(409).send({
      error: { code: "PHASE8_CONFLICT", message: error.message },
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return reply.status(409).send({
        error: {
          code: "CALENDAR_DAY_EXISTS",
          message: "A calendar entry already exists for this date.",
        },
      });
    }
    if (error.code === "P2003") {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Referenced record not found." },
      });
    }
  }
  throw error;
}

export async function registerPhase8Routes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const authorizeCalendarRead = createRequirePermission(
    options.authSessionService,
    PHASE8_PERMISSIONS.calendarRead,
  );
  const authorizeCalendarCreate = createRequirePermission(
    options.authSessionService,
    PHASE8_PERMISSIONS.calendarCreate,
  );
  const authorizeCalendarUpdate = createRequirePermission(
    options.authSessionService,
    PHASE8_PERMISSIONS.calendarUpdate,
  );
  const authorizeReportRead = createRequirePermission(
    options.authSessionService,
    PHASE8_PERMISSIONS.reportRead,
  );

  app.get<{ Querystring: CalendarQuery }>(
    "/api/v1/academic-calendar",
    { preHandler: authorizeCalendarRead },
    async (request, reply) => {
      try {
        const range = parseRange(request.query);
        const data = await options.service.listCalendarDays(
          requireAuth(request).institutionId,
          range.startDate,
          range.endDate,
        );
        return reply.status(200).send({
          data,
          range: {
            startDate: range.startDate.toISOString().slice(0, 10),
            endDate: range.endDate.toISOString().slice(0, 10),
          },
        });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post(
    "/api/v1/academic-calendar",
    { preHandler: authorizeCalendarCreate },
    async (request, reply) => {
      try {
        const parsed = parseCalendarDayInput(request.body, "create");
        const row = await options.service.createCalendarDay(
          auditContext(request),
          {
            calendarDate: parsed.data.calendarDate!,
            dayType: parsed.data.dayType!,
            label: parsed.data.label,
            reason: parsed.reason,
          },
        );
        return reply.status(201).send({ data: row });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.patch<{ Params: IdParams }>(
    "/api/v1/academic-calendar/:id",
    { preHandler: authorizeCalendarUpdate },
    async (request, reply) => {
      try {
        const parsed = parseCalendarDayInput(request.body, "update");
        const row = await options.service.updateCalendarDay(
          auditContext(request),
          parseUuid(request.params.id, "id"),
          {
            dayType: parsed.data.dayType,
            label: parsed.data.label,
            reason: parsed.reason,
          },
        );
        return reply.status(200).send({ data: row });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.get<{ Querystring: CalendarQuery }>(
    "/api/v1/attendance/reports",
    { preHandler: authorizeReportRead },
    async (request, reply) => {
      try {
        const report = await options.service.buildReport(
          requireAuth(request).institutionId,
          parseRange(request.query),
        );
        return reply.status(200).send({ data: report });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );
}
