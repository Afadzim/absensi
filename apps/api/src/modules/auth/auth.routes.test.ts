import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

import { registerAuthRoutes } from "./auth.routes.js";

describe("GET /api/v1/auth/me", () => {
  function buildApp(
    validateSession: ReturnType<typeof vi.fn>,
  ) {
    const app = Fastify();

    app.register(cookie);

    const authSessionService = {
      validateSession,
    } as any;

    app.register(async (instance) => {
      await registerAuthRoutes(instance, {
        authSessionService,
      });
    });

    return app;
  }

  it("returns 401 when session is missing", async () => {
    const validateSession = vi.fn();

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
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

  it("returns authenticated user context", async () => {
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
      url: "/api/v1/auth/me",
      cookies: {
        "__Host-am_session": "valid-session-token",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toEqual({
      user: {
        id: "user-001",
        institutionId: "institution-001",
        teacherId: "teacher-001",
        roles: ["GURU"],
        permissions: [
          "attendance.session.view",
          "attendance.session.create",
        ],
      },
    });

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
      url: "/api/v1/auth/me",
      cookies: {
        "__Host-am_session": "operator-session-token",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json().user).toEqual({
      id: "user-002",
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

  it("does not expose sensitive session data", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue({
        sessionId: "session-sensitive",
        userId: "user-sensitive",
        institutionId: "institution-001",
        teacherId: "teacher-sensitive",
        roles: ["GURU"],
        permissions: ["attendance.session.view"],
      });

    const app = buildApp(validateSession);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: {
        "__Host-am_session": "super-secret-session-token",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.user).not.toHaveProperty(
      "sessionId",
    );

    expect(body.user).not.toHaveProperty(
      "sessionToken",
    );

    expect(body.user).not.toHaveProperty(
      "password",
    );

    expect(body.user).not.toHaveProperty(
      "passwordHash",
    );

    expect(body.user).not.toHaveProperty(
      "csrfToken",
    );

    expect(JSON.stringify(body)).not.toContain(
      "super-secret-session-token",
    );

    await app.close();
  });
});
