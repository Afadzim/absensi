import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import { AUTH_CONSTANTS } from "../auth/auth.constants.js";
import { buildApp } from "../../app.js";
import type { MasterDataService } from "./master-data.service.js";

const SESSION_TOKEN = "session-token";
const CSRF_TOKEN = "c".repeat(43);
const AUTH_CONTEXT = {
  sessionId: "session-001",
  userId: "user-001",
  institutionId: "11111111-1111-4111-8111-111111111111",
  teacherId: null,
  roles: ["ADMIN"],
  permissions: [
    "master_data.student.read",
    "master_data.student.create",
    "master_data.student.update",
    "master_data.user.read",
  ],
};

describe("Master data HTTP routes", () => {
  let app: ReturnType<typeof buildApp>;
  let service: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    listRoles: ReturnType<typeof vi.fn>;
  };
  let authSessionService: {
    validateSession: ReturnType<typeof vi.fn>;
    verifyCsrfToken: ReturnType<typeof vi.fn>;
  };

  function buildTestApp() {
    service = {
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "record-001" }),
      update: vi.fn().mockResolvedValue({ id: "record-001" }),
      listRoles: vi.fn().mockResolvedValue([]),
    };
    authSessionService = {
      validateSession: vi.fn().mockResolvedValue(AUTH_CONTEXT),
      verifyCsrfToken: vi.fn().mockResolvedValue(true),
    };
    app = buildApp({
      masterDataService: service as unknown as MasterDataService,
      authSessionService:
        authSessionService as unknown as AuthSessionService,
    });
  }

  function cookieOptions() {
    return {
      cookies: {
        [AUTH_CONSTANTS.SESSION_COOKIE_NAME]: SESSION_TOKEN,
        [AUTH_CONSTANTS.CSRF_COOKIE_NAME]: CSRF_TOKEN,
      },
      headers: {
        [AUTH_CONSTANTS.CSRF_HEADER_NAME]: CSRF_TOKEN,
      },
    };
  }

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("lists only through a per-entity read permission and passes AuthContext tenant", async () => {
    buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/master-data/students?page=2&pageSize=10",
      cookies: cookieOptions().cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      "students",
      AUTH_CONTEXT.institutionId,
      { page: 2, pageSize: 10 },
    );
  });

  it("requires authentication and denies missing entity permission", async () => {
    buildTestApp();

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/master-data/students",
    });
    expect(unauthenticated.statusCode).toBe(401);

    authSessionService.validateSession.mockResolvedValueOnce({
      ...AUTH_CONTEXT,
      permissions: [],
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/master-data/students",
      cookies: cookieOptions().cookies,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("creates records with tenant and audit actor from AuthContext", async () => {
    buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/master-data/students",
      ...cookieOptions(),
      payload: { code: "S-01", name: "Student", institutionId: "spoofed" },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      "students",
      expect.objectContaining({
        auth: expect.objectContaining({
          userId: AUTH_CONTEXT.userId,
          institutionId: AUTH_CONTEXT.institutionId,
        }),
      }),
      expect.objectContaining({
        institutionId: "spoofed",
      }),
    );
  });

  it("requires a valid CSRF token for create and does not expose delete", async () => {
    buildTestApp();
    authSessionService.verifyCsrfToken.mockResolvedValueOnce(false);

    const invalidCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/master-data/students",
      ...cookieOptions(),
      payload: { code: "S-01", name: "Student" },
    });
    expect(invalidCsrf.statusCode).toBe(403);
    expect(service.create).not.toHaveBeenCalled();

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/v1/master-data/students/11111111-1111-4111-8111-111111111111",
      ...cookieOptions(),
    });
    expect(deleteResponse.statusCode).toBe(404);
  });

  it("does not expose password hashes through the roles lookup route", async () => {
    buildTestApp();
    service.listRoles.mockResolvedValueOnce([
      { id: "role-001", name: "ADMIN", description: null },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/master-data/lookups/roles",
      cookies: cookieOptions().cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      { id: "role-001", name: "ADMIN", description: null },
    ]);
  });
});
