import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import { AUTH_CONSTANTS } from "../auth/auth.constants.js";
import { buildApp } from "../../app.js";
import type { ScheduleService } from "./schedule.service.js";

const CSRF_TOKEN = "c".repeat(43);
const AUTH_CONTEXT = {
  sessionId: "session-schedule",
  userId: "user-schedule",
  institutionId: "11111111-1111-4111-8111-111111111111",
  teacherId: null,
  roles: ["ADMIN"],
  permissions: ["schedule.read", "schedule.create", "schedule.update"],
};

describe("Schedule HTTP routes", () => {
  let app: ReturnType<typeof buildApp>;
  let service: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    createStudentParticipant: ReturnType<typeof vi.fn>;
    updateStudentParticipant: ReturnType<typeof vi.fn>;
  };
  let authSessionService: {
    validateSession: ReturnType<typeof vi.fn>;
    verifyCsrfToken: ReturnType<typeof vi.fn>;
  };

  function buildTestApp() {
    service = {
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "schedule-001" }),
      update: vi.fn().mockResolvedValue({ id: "schedule-001" }),
      createStudentParticipant: vi.fn().mockResolvedValue({ id: "participant-001" }),
      updateStudentParticipant: vi.fn().mockResolvedValue({ id: "participant-001" }),
    };
    authSessionService = {
      validateSession: vi.fn().mockResolvedValue(AUTH_CONTEXT),
      verifyCsrfToken: vi.fn().mockResolvedValue(true),
    };
    app = buildApp({
      scheduleService: service as unknown as ScheduleService,
      authSessionService: authSessionService as unknown as AuthSessionService,
    });
  }

  function authOptions() {
    return {
      cookies: {
        [AUTH_CONSTANTS.SESSION_COOKIE_NAME]: "session-token",
        [AUTH_CONSTANTS.CSRF_COOKIE_NAME]: CSRF_TOKEN,
      },
      headers: { [AUTH_CONSTANTS.CSRF_HEADER_NAME]: CSRF_TOKEN },
    };
  }

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("lists schedules only within the authenticated tenant and applies filters", async () => {
    buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/schedules?page=2&pageSize=20&dayOfWeek=7",
      cookies: authOptions().cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      AUTH_CONTEXT.institutionId,
      {
        page: 2,
        pageSize: 20,
        academicYearId: undefined,
        semesterId: undefined,
        dayOfWeek: 7,
      },
    );
  });

  it("denies access without schedule permission and requires CSRF on mutations", async () => {
    buildTestApp();
    authSessionService.validateSession.mockResolvedValueOnce({
      ...AUTH_CONTEXT,
      permissions: [],
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/schedules",
      cookies: authOptions().cookies,
    });
    expect(forbidden.statusCode).toBe(403);

    authSessionService.verifyCsrfToken.mockResolvedValueOnce(false);
    const invalidCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/schedules",
      ...authOptions(),
      payload: {},
    });
    expect(invalidCsrf.statusCode).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("uses AuthContext tenant for schedule creation and participant overrides", async () => {
    buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/schedules",
      ...authOptions(),
      payload: { institutionId: "spoofed" },
    });
    expect(created.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          userId: AUTH_CONTEXT.userId,
          institutionId: AUTH_CONTEXT.institutionId,
        }),
      }),
      { institutionId: "spoofed" },
    );

    const override = await app.inject({
      method: "POST",
      url: "/api/v1/schedules/11111111-1111-4111-8111-111111111111/student-participants",
      ...authOptions(),
      payload: { studentId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(override.statusCode).toBe(201);
    expect(service.createStudentParticipant).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          institutionId: AUTH_CONTEXT.institutionId,
        }),
      }),
      "11111111-1111-4111-8111-111111111111",
      { studentId: "22222222-2222-4222-8222-222222222222" },
    );
  });

  it("does not expose a schedule delete operation", async () => {
    buildTestApp();
    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/schedules/11111111-1111-4111-8111-111111111111",
      ...authOptions(),
    });
    expect(response.statusCode).toBe(404);
  });
});
