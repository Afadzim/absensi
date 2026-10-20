import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

import { registerAuthRoutes } from "./auth.routes.js";
import { AUTH_CONSTANTS } from "./auth.constants.js";
import type { AuthSessionService } from "./auth.session.service.js";

describe("GET /api/v1/auth/me", () => {
  function buildApp(
    validateSession: ReturnType<typeof vi.fn>,
    overrides: Partial<AuthSessionService> = {},
  ) {
    const app = Fastify();

    app.register(cookie);

    const authSessionService = {
      validateSession,
      authenticateCredentials: vi.fn().mockResolvedValue(null),
      verifyCsrfToken: vi.fn().mockResolvedValue(true),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as AuthSessionService;

    app.register(async (instance) => {
      await registerAuthRoutes(instance, {
        authSessionService,
      });
    });

    return app;
  }

  it("login membuat session dan mengatur cookie aman", async () => {
    const authenticateCredentials = vi.fn().mockResolvedValue({
      sessionId: "session-001",
      sessionToken: "s".repeat(43),
      csrfToken: "c".repeat(43),
      createdAt: new Date("2026-10-20T00:00:00.000Z"),
      lastSeenAt: new Date("2026-10-20T00:00:00.000Z"),
      expiresAt: new Date("2026-10-20T12:00:00.000Z"),
    });
    const app = buildApp(vi.fn(), { authenticateCredentials });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        institutionId: "11111111-1111-4111-8111-111111111111",
        username: "user",
        password: "Valid password",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      csrfToken: "c".repeat(43),
      expiresAt: "2026-10-20T12:00:00.000Z",
    });
    expect(authenticateCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionId: "11111111-1111-4111-8111-111111111111",
        username: "user",
        password: "Valid password",
      }),
    );

    const cookies = response.headers["set-cookie"];
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `${AUTH_CONSTANTS.SESSION_COOKIE_NAME}=`,
        ),
        expect.stringContaining(
          `${AUTH_CONSTANTS.CSRF_COOKIE_NAME}=`,
        ),
      ]),
    );
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("HttpOnly"),
        expect.stringContaining("Secure"),
        expect.stringContaining("SameSite=Strict"),
        expect.stringContaining("Path=/"),
      ]),
    );

    await app.close();
  });

  it("login menolak kredensial invalid dengan respons generik", async () => {
    const authenticateCredentials = vi.fn().mockResolvedValue(null);
    const app = buildApp(vi.fn(), { authenticateCredentials });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        institutionId: "11111111-1111-4111-8111-111111111111",
        username: "unknown",
        password: "Wrong password",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials.",
      },
    });

    await app.close();
  });

  it("logout merevoke session dan menghapus cookie setelah CSRF valid", async () => {
    const validateSession = vi.fn().mockResolvedValue({
      sessionId: "session-001",
      userId: "user-001",
      institutionId: "institution-001",
      teacherId: null,
      roles: [],
      permissions: [],
    });
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const verifyCsrfToken = vi.fn().mockResolvedValue(true);
    const app = buildApp(validateSession, {
      revokeSession,
      verifyCsrfToken,
    });
    const csrfToken = "c".repeat(43);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: {
        [AUTH_CONSTANTS.SESSION_COOKIE_NAME]: "s".repeat(43),
        [AUTH_CONSTANTS.CSRF_COOKIE_NAME]: csrfToken,
      },
      headers: {
        [AUTH_CONSTANTS.CSRF_HEADER_NAME]: csrfToken,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(revokeSession).toHaveBeenCalledWith(
      "session-001",
      "institution-001",
    );
    expect(verifyCsrfToken).toHaveBeenCalledWith(
      "session-001",
      csrfToken,
    );

    const cookies = response.headers["set-cookie"];
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `${AUTH_CONSTANTS.SESSION_COOKIE_NAME}=`,
        ),
        expect.stringContaining(
          `${AUTH_CONSTANTS.CSRF_COOKIE_NAME}=`,
        ),
      ]),
    );

    await app.close();
  });

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
