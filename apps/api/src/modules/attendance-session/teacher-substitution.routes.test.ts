import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildApp } from "../../app.js";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import type { TeacherSubstitutionService } from "./teacher-substitution.service.js";
import { TEACHER_SUBSTITUTION_PERMISSIONS } from "./teacher-substitution.permissions.js";

const INSTITUTION_ID = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID = "22222222-2222-4222-8222-222222222222";
const SUBSTITUTE_ID = "33333333-3333-4333-8333-333333333333";
const SUBSTITUTION_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_TOKEN = "a".repeat(43);
const CSRF_TOKEN = "b".repeat(43);
const permissions = Object.values(TEACHER_SUBSTITUTION_PERMISSIONS);

function createAuthSessionServiceMock() {
  return {
    validateSession: vi.fn().mockImplementation(async () => ({
      sessionId: "auth-session-id",
      userId: "admin-user-id",
      institutionId: INSTITUTION_ID,
      teacherId: null,
      roles: ["ADMIN"],
      permissions,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })),
    verifyCsrfToken: vi.fn().mockResolvedValue(true),
  };
}

function createServiceMock() {
  return {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ id: SUBSTITUTION_ID, status: "PENDING" }),
    approve: vi.fn().mockResolvedValue({ id: SUBSTITUTION_ID, status: "APPROVED" }),
    reject: vi.fn().mockResolvedValue({ id: SUBSTITUTION_ID, status: "REJECTED" }),
    cancel: vi.fn().mockResolvedValue({ id: SUBSTITUTION_ID, status: "CANCELLED" }),
  };
}

describe("Teacher substitution HTTP routes", () => {
  let authSessionService: ReturnType<typeof createAuthSessionServiceMock>;
  let service: ReturnType<typeof createServiceMock>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    authSessionService = createAuthSessionServiceMock();
    service = createServiceMock();
    app = buildApp({
      teacherSubstitutionService:
        service as unknown as TeacherSubstitutionService,
      authSessionService:
        authSessionService as unknown as AuthSessionService,
    });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  function inject(options: {
    method: "POST" | "GET";
    url: string;
    csrf?: boolean;
    payload?: object;
  }) {
    return app.inject({
      method: options.method,
      url: options.url,
      payload: options.payload,
      cookies: {
        "__Host-am_session": SESSION_TOKEN,
        ...(options.csrf === false ? {} : { "__Host-am_csrf": CSRF_TOKEN }),
      },
      headers: {
        ...(options.csrf === false ? {} : { "x-csrf-token": CSRF_TOKEN }),
      },
    });
  }

  it("creates a pending substitution using the authenticated tenant and audit context", async () => {
    const response = await inject({
      method: "POST",
      url: `/api/v1/schedules/${SCHEDULE_ID}/substitutions`,
      payload: {
        substituteTeacherId: SUBSTITUTE_ID,
        substitutionDate: "2026-09-25",
        startTime: "07:00",
        endTime: "07:40",
        reason: "Teacher is attending an official event",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ institutionId: INSTITUTION_ID }),
      }),
      SCHEDULE_ID,
      {
        substituteTeacherId: SUBSTITUTE_ID,
        substitutionDate: new Date("2026-09-25T00:00:00.000Z"),
        startTime: new Date("1970-01-01T07:00:00.000Z"),
        endTime: new Date("1970-01-01T07:40:00.000Z"),
        reason: "Teacher is attending an official event",
      },
      undefined,
    );
  });

  it("enforces owner-managed permission and CSRF for state changes", async () => {
    authSessionService.validateSession.mockImplementationOnce(async () => ({
      sessionId: "auth-session-id",
      userId: "user-id",
      institutionId: INSTITUTION_ID,
      teacherId: null,
      roles: [],
      permissions: [],
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const denied = await inject({
      method: "POST",
      url: `/api/v1/substitutions/${SUBSTITUTION_ID}/approve`,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");

    const csrfRejected = await inject({
      method: "POST",
      url: `/api/v1/substitutions/${SUBSTITUTION_ID}/approve`,
      csrf: false,
    });
    expect(csrfRejected.statusCode).toBe(403);
    expect(csrfRejected.json().error.code).toBe("CSRF_INVALID");
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("lists tenant-scoped schedule substitutions and rejects invalid time input", async () => {
    const listed = await inject({
      method: "GET",
      url: `/api/v1/schedules/${SCHEDULE_ID}/substitutions?substitutionDate=2026-09-25`,
    });
    expect(listed.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(INSTITUTION_ID, SCHEDULE_ID, {
      page: 1,
      pageSize: 50,
      substitutionDate: new Date("2026-09-25T00:00:00.000Z"),
    });

    const invalid = await inject({
      method: "POST",
      url: `/api/v1/schedules/${SCHEDULE_ID}/substitutions`,
      payload: {
        substituteTeacherId: SUBSTITUTE_ID,
        substitutionDate: "2026-09-25",
        startTime: "07:00",
        endTime: "25:00",
        reason: "Invalid time",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("BAD_REQUEST");
    expect(service.create).not.toHaveBeenCalled();
  });
});
