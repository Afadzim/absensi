import type { FastifyInstance, FastifyReply } from "fastify";

import { AUTH_CONSTANTS } from "./auth.constants.js";
import {
  AUTH_CSRF_COOKIE,
  AUTH_SESSION_COOKIE,
  createAuthenticateRequest,
  createCsrfProtection,
} from "./auth.middleware.js";
import type { AuthSessionService } from "./auth.session.service.js";

export interface AuthRouteOptions {
  authSessionService: AuthSessionService;
}

type LoginBody = {
  institutionId?: unknown;
  username?: unknown;
  password?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalidLogin(reply: FastifyReply) {
  return reply.status(401).send({
    error: {
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials.",
    },
  });
}

function setAuthCookies(
  reply: FastifyReply,
  sessionToken: string,
  csrfToken: string,
): void {
  reply
    .setCookie(AUTH_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: AUTH_CONSTANTS.SESSION_COOKIE_MAX_AGE_SECONDS,
    })
    .setCookie(AUTH_CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: AUTH_CONSTANTS.SESSION_COOKIE_MAX_AGE_SECONDS,
    });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const authenticateRequest =
    createAuthenticateRequest(options.authSessionService);
  const protectAgainstCsrf =
    createCsrfProtection(options.authSessionService);

  app.post<{ Body: LoginBody }>(
    "/api/v1/auth/login",
    async (request, reply) => {
      const body = request.body ?? {};

      if (
        typeof body.institutionId !== "string" ||
        !UUID_PATTERN.test(body.institutionId) ||
        typeof body.username !== "string" ||
        body.username.trim().length === 0 ||
        body.username.length > 100 ||
        typeof body.password !== "string" ||
        body.password.length === 0 ||
        body.password.length > AUTH_CONSTANTS.PASSWORD_MAX_LENGTH
      ) {
        return invalidLogin(reply);
      }

      const session =
        await options.authSessionService.authenticateCredentials({
          institutionId: body.institutionId,
          username: body.username.trim(),
          password: body.password,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });

      if (!session) {
        return invalidLogin(reply);
      }

      setAuthCookies(reply, session.sessionToken, session.csrfToken);

      return reply.status(200).send({
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
    },
  );

  app.get(
    "/api/v1/auth/me",
    {
      preHandler: authenticateRequest,
    },
    async (request) => {
      const auth = request.auth;

      if (!auth) {
        throw new Error("AuthContext missing after authentication.");
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

  app.post(
    "/api/v1/auth/logout",
    {
      preHandler: [authenticateRequest, protectAgainstCsrf],
    },
    async (request, reply) => {
      const auth = request.auth;

      if (!auth) {
        throw new Error("AuthContext missing after authentication.");
      }

      await options.authSessionService.revokeSession(
        auth.sessionId,
        auth.institutionId,
      );

      reply.clearCookie(AUTH_SESSION_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
      });
      reply.clearCookie(AUTH_CSRF_COOKIE, {
        httpOnly: false,
        secure: true,
        sameSite: "strict",
        path: "/",
      });

      return reply.status(204).send();
    },
  );
}
