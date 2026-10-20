import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AUTH_CONSTANTS } from "./auth.constants.js";
import { AuthSessionService } from "./auth.session.service.js";

export const AUTH_SESSION_COOKIE = AUTH_CONSTANTS.SESSION_COOKIE_NAME;
export const AUTH_CSRF_COOKIE = AUTH_CONSTANTS.CSRF_COOKIE_NAME;

export class AuthenticationError extends Error {
  constructor(
    message = "Authentication required.",
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

function readSessionToken(
  request: FastifyRequest,
): string | null {
  const cookies = (
    request as FastifyRequest & {
      cookies?: Record<string, string | undefined>;
    }
  ).cookies;

  const token = cookies?.[AUTH_SESSION_COOKIE];

  if (typeof token !== "string" || token.length === 0) {
    return null;
  }

  return token;
}

export function createAuthenticateRequest(
  authSessionService: AuthSessionService,
) {
  return async function authenticateRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const sessionToken =
      readSessionToken(request);

    if (!sessionToken) {
      await reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
      return;
    }

    const session =
      await authSessionService.validateSession(
        sessionToken,
      );

    if (!session) {
      await reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
      return;
    }

    request.auth = {
      sessionId: session.sessionId,
      userId: session.userId,
      institutionId: session.institutionId,
      teacherId: session.teacherId,
      roles: session.roles,
      permissions: session.permissions,
    };
  };
}

export function createCsrfProtection(
  authSessionService: AuthSessionService,
) {
  return async function protectAgainstCsrf(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return;
    }

    const auth = request.auth;

    if (!auth) {
      await reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
      return;
    }

    const cookies = (
      request as FastifyRequest & {
        cookies?: Record<string, string | undefined>;
      }
    ).cookies;
    const cookieToken = cookies?.[AUTH_CSRF_COOKIE];
    const headerToken = request.headers[AUTH_CONSTANTS.CSRF_HEADER_NAME];

    if (
      typeof cookieToken !== "string" ||
      typeof headerToken !== "string" ||
      cookieToken !== headerToken ||
      !(await authSessionService.verifyCsrfToken(
        auth.sessionId,
        headerToken,
      ))
    ) {
      await reply.status(403).send({
        error: {
          code: "CSRF_INVALID",
          message: "CSRF token is missing or invalid.",
        },
      });
    }
  };
}

export function createRequirePermission(
  authSessionService: AuthSessionService,
  permission: string,
) {
  const authenticateRequest =
    createAuthenticateRequest(authSessionService);
  const protectAgainstCsrf =
    createCsrfProtection(authSessionService);

  return async function requirePermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await authenticateRequest(request, reply);

    if (reply.sent) {
      return;
    }

    if (!request.auth?.permissions.includes(permission)) {
      await reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Permission denied.",
        },
      });
      return;
    }

    await protectAgainstCsrf(request, reply);
  };
}
