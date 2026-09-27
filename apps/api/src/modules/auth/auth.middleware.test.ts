import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

import {
  createAuthenticateRequest,
} from "./auth.middleware.js";

describe("authenticateRequest", () => {
  function buildApp(
    validateSession: ReturnType<typeof vi.fn>,
  ) {
    const app = Fastify();

    app.register(cookie);

    const authSessionService = {
      validateSession,
    } as any;

    app.register(async (instance) => {
      instance.addHook(
        "preHandler",
        createAuthenticateRequest(
          authSessionService,
        ),
      );

      instance.get("/protected", async (request) => {
        return {
          auth: request.auth,
        };
      });
    });

    return app;
  }

  it("returns 401 when session cookie is missing", async () => {
    const validateSession = vi.fn();

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      },
    });

    expect(validateSession).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns 401 when session is invalid", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue(null);

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: {
        "__Host-am_session": "invalid-session-token",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      },
    });

    expect(validateSession).toHaveBeenCalledWith(
      "invalid-session-token",
    );

    await app.close();
  });

  it("accepts a valid session and builds AuthContext", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue({
        sessionId: "session-001",
        userId: "user-001",
        institutionId: "institution-001",
        teacherId: "teacher-001",
        roles: ["GURU"],
        permissions: [
          "attendance.session.view",
          "attendance.session.create",
        ],
      });

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: {
        "__Host-am_session": "valid-session-token",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toEqual({
      auth: {
        sessionId: "session-001",
        userId: "user-001",
        institutionId: "institution-001",
        teacherId: "teacher-001",
        roles: ["GURU"],
        permissions: [
          "attendance.session.view",
          "attendance.session.create",
        ],
      },
    });

    expect(validateSession).toHaveBeenCalledWith(
      "valid-session-token",
    );

    await app.close();
  });

  it("preserves null teacherId", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue({
        sessionId: "session-002",
        userId: "user-002",
        institutionId: "institution-001",
        teacherId: null,
        roles: ["OPERATOR"],
        permissions: [
          "attendance.session.view",
          "attendance.session.cancel",
        ],
      });

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: {
        "__Host-am_session": "operator-session-token",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json().auth).toEqual({
      sessionId: "session-002",
      userId: "user-002",
      institutionId: "institution-001",
      teacherId: null,
      roles: ["OPERATOR"],
      permissions: [
        "attendance.session.view",
        "attendance.session.cancel",
      ],
    });

    await app.close();
  });

  it("does not expose session token in AuthContext", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue({
        sessionId: "session-003",
        userId: "user-003",
        institutionId: "institution-001",
        teacherId: "teacher-003",
        roles: ["GURU"],
        permissions: ["attendance.session.view"],
      });

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: {
        "__Host-am_session": "super-secret-token",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.auth).not.toHaveProperty(
      "sessionToken",
    );

    expect(JSON.stringify(body)).not.toContain(
      "super-secret-token",
    );

    await app.close();
  });
});
