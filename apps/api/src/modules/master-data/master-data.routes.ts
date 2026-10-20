import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { Prisma } from "../../../generated/prisma/client.js";
import type { AuthContext } from "../auth/auth.context.js";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import {
  createAuthenticateRequest,
  createRequirePermission,
} from "../auth/auth.middleware.js";
import {
  MASTER_DATA_PERMISSIONS,
} from "./master-data.permissions.js";
import {
  MasterDataConflictError,
  MasterDataNotFoundError,
  MasterDataService,
  parseMasterDataResource,
} from "./master-data.service.js";
import { MasterDataInputError } from "./master-data.validation.js";

interface MasterDataRouteOptions {
  service: MasterDataService;
  authSessionService: AuthSessionService;
}

interface ResourceParams {
  resource: string;
  id?: string;
}

interface ListQuery {
  page?: string;
  pageSize?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parsePage(query: ListQuery): { page: number; pageSize: number } {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 50 : Number(query.pageSize);

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new MasterDataInputError("page must be a positive integer.");
  }

  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new MasterDataInputError("pageSize must be between 1 and 100.");
  }

  return { page, pageSize };
}

function sendKnownError(reply: FastifyReply, error: unknown) {
  if (error instanceof MasterDataInputError) {
    return reply.status(400).send({
      error: { code: "BAD_REQUEST", message: error.message },
    });
  }

  if (error instanceof MasterDataNotFoundError) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: error.message },
    });
  }

  if (error instanceof MasterDataConflictError) {
    return reply.status(409).send({
      error: { code: "MASTER_DATA_CONFLICT", message: error.message },
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return reply.status(409).send({
        error: {
          code: "MASTER_DATA_CONFLICT",
          message: "A record with the same unique value already exists.",
        },
      });
    }
    if (error.code === "P2003" || error.code === "P2025") {
      return reply.status(409).send({
        error: {
          code: "MASTER_DATA_CONFLICT",
          message: "A referenced record is missing or still in use.",
        },
      });
    }
    if (error.code === "P2004") {
      return reply.status(409).send({
        error: {
          code: "MASTER_DATA_CONFLICT",
          message: "The operation violates a data integrity constraint.",
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
        code: "MASTER_DATA_CONFLICT",
        message:
          "Student already has an enrollment overlapping this date range in the academic year.",
      },
    });
  }

  throw error;
}

function getResource(request: FastifyRequest<{ Params: ResourceParams }>) {
  return parseMasterDataResource(request.params.resource);
}

function auditContext(request: FastifyRequest) {
  const auth = requireAuth(request);
  return {
    auth,
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

function requireAuth(request: FastifyRequest): AuthContext {
  const auth = request.auth;
  if (!auth) {
    throw new Error("AuthContext missing after permission check.");
  }
  return auth;
}

export async function registerMasterDataRoutes(
  app: FastifyInstance,
  options: MasterDataRouteOptions,
): Promise<void> {
  const authorize = (operation: "read" | "create" | "update") =>
    async (
      request: FastifyRequest<{ Params: ResourceParams }>,
      reply: FastifyReply,
    ): Promise<void> => {
      const resource = getResource(request);
      if (!resource) {
        await reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Master data resource not found." },
        });
        return;
      }
      const permissions = MASTER_DATA_PERMISSIONS[resource] as Partial<
        Record<"read" | "create" | "update", string>
      >;
      const permission = permissions[operation];
      if (!permission) {
        await reply.status(405).send({
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "This operation is not available for the resource.",
          },
        });
        return;
      }
      await createRequirePermission(
        options.authSessionService,
        permission,
      )(request, reply);
    };

  app.get(
    "/api/v1/master-data/lookups/roles",
    {
      preHandler: async (request, reply) => {
        await createAuthenticateRequest(
          options.authSessionService,
        )(request, reply);
        if (reply.sent) return;
        const userPermissions = Object.values(
          MASTER_DATA_PERMISSIONS.users,
        ).filter((permission): permission is string => Boolean(permission));
        if (
          !request.auth?.permissions.some((permission) =>
            userPermissions.includes(permission),
          )
        ) {
          await reply.status(403).send({
            error: { code: "FORBIDDEN", message: "Permission denied." },
          });
        }
      },
    },
    async (request, reply) => {
      try {
        return reply.status(200).send({
          data: await options.service.listRoles(),
        });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.get<{
    Params: ResourceParams;
    Querystring: ListQuery;
  }>(
    "/api/v1/master-data/:resource",
    { preHandler: authorize("read") },
    async (request, reply) => {
      const resource = getResource(request);
      if (!resource) return reply.status(404).send();

      try {
        const page = parsePage(request.query);
        const result = await options.service.list(
          resource,
          requireAuth(request).institutionId,
          page,
        );
        return reply.status(200).send({
          data: result.data,
          pagination: {
            page: page.page,
            pageSize: page.pageSize,
            total: result.total,
          },
        });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.get<{ Params: ResourceParams }>(
    "/api/v1/master-data/:resource/:id",
    { preHandler: authorize("read") },
    async (request, reply) => {
      const resource = getResource(request);
      if (!resource) return reply.status(404).send();
      const id = request.params.id;
      if (!id || !UUID_PATTERN.test(id)) {
        return reply.status(400).send({
          error: { code: "BAD_REQUEST", message: "id must be a valid UUID." },
        });
      }

      try {
        const result = await options.service.get(
          resource,
          requireAuth(request).institutionId,
          id,
        );
        if (!result) {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: "Master data record not found." },
          });
        }
        return reply.status(200).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.post<{ Params: ResourceParams }>(
    "/api/v1/master-data/:resource",
    { preHandler: authorize("create") },
    async (request, reply) => {
      const resource = getResource(request);
      if (!resource) return reply.status(404).send();

      try {
        const result = await options.service.create(
          resource,
          auditContext(request),
          request.body,
        );
        return reply.status(201).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );

  app.patch<{ Params: ResourceParams }>(
    "/api/v1/master-data/:resource/:id",
    { preHandler: authorize("update") },
    async (request, reply) => {
      const resource = getResource(request);
      if (!resource) return reply.status(404).send();
      const id = request.params.id;
      if (!id || !UUID_PATTERN.test(id)) {
        return reply.status(400).send({
          error: { code: "BAD_REQUEST", message: "id must be a valid UUID." },
        });
      }

      try {
        const result = await options.service.update(
          resource,
          auditContext(request),
          id,
          request.body,
        );
        if (!result) {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: "Master data record not found." },
          });
        }
        return reply.status(200).send({ data: result });
      } catch (error) {
        return sendKnownError(reply, error);
      }
    },
  );
}
