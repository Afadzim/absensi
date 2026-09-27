import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AuthSessionService } from "./auth.session.service.js";

export const AUTH_SESSION_COOKIE =
  "__Host-am_session";

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

  if (
    typeof token !== "string" ||
    token.length === 0
  ) {
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
