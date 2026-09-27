import type { FastifyInstance } from "fastify";

import type { AuthSessionService } from "./auth.session.service.js";
import { createAuthenticateRequest } from "./auth.middleware.js";

export interface AuthRouteOptions {
  authSessionService: AuthSessionService;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const authenticateRequest =
    createAuthenticateRequest(
      options.authSessionService,
    );

  app.get(
    "/api/v1/auth/me",
    {
      preHandler: authenticateRequest,
    },
    async (request) => {
      const auth = request.auth;

      if (!auth) {
        throw new Error(
          "AuthContext missing after authentication.",
        );
      }

      return {
        user: {
          id: auth.userId,
          institutionId: auth.institutionId,
          teacherId: auth.teacherId,
          roles: auth.roles,
          permissions: auth.permissions,
        },
      };
    },
  );
}
