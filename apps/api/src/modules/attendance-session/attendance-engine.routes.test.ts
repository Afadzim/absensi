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
import type { AttendanceEngineService } from "./attendance-engine.service.js";
import { ATTENDANCE_ENGINE_PERMISSIONS } from "./attendance-engine.permissions.js";

const INSTITUTION_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_TOKEN = "a".repeat(43);
const CSRF_TOKEN = "b".repeat(43);

const allPermissions = Object.values(ATTENDANCE_ENGINE_PERMISSIONS);

function createAuthSessionServiceMock() {
  return {
    validateSession: vi.fn().mockImplementation(async () => ({
      sessionId: "auth-session-id",
      userId: "user-id",
      institutionId: INSTITUTION_ID,
      teacherId: TEACHER_ID,
      roles: ["TEACHER"],
      permissions: allPermissions,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })),
    verifyCsrfToken: vi.fn().mockResolvedValue(true),
  };
}

function createAttendanceEngineServiceMock() {
  return {
    createGateCheckIn: vi.fn().mockResolvedValue({
      data: { id: "gate-event-id" },
      duplicate: false,
    }),
    getStudentRoster: vi.fn().mockResolvedValue([{ studentId: STUDENT_ID }]),
    markStudentPresent: vi.fn().mockResolvedValue({
      id: "student-attendance-id",
      status: "HADIR",
    }),
    createStudentAdministrativeStatus: vi.fn().mockResolvedValue({
      id: "admin-status-id",
    }),
    updateStudentAdministrativeStatus: vi.fn().mockResolvedValue({
      id: "admin-status-id",
    }),
  };
}

describe("AttendanceEngine HTTP routes", () => {
  let authSessionService: ReturnType<typeof createAuthSessionServiceMock>;
  let service: ReturnType<typeof createAttendanceEngineServiceMock>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    authSessionService = createAuthSessionServiceMock();
    service = createAttendanceEngineServiceMock();
    app = buildApp({
      attendanceEngineService:
        service as unknown as AttendanceEngineService,
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

  it("records a gate check-in with tenant and audit context from authentication", async () => {
    const response = await inject({
      method: "POST",
      url: "/api/v1/gate-events/check-in",
      payload: {
        studentId: STUDENT_ID,
        eventAt: "2026-09-25T07:05:00.000Z",
        clientEventId: "client-gate-event-1",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.createGateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ institutionId: INSTITUTION_ID }),
      }),
      {
        studentId: STUDENT_ID,
        eventAt: new Date("2026-09-25T07:05:00.000Z"),
        clientEventId: "client-gate-event-1",
        source: undefined,
      },
    );
  });

  it("requires the route permission and CSRF token before mutating", async () => {
    authSessionService.validateSession.mockImplementationOnce(async () => ({
      sessionId: "auth-session-id",
      userId: "user-id",
      institutionId: INSTITUTION_ID,
      teacherId: TEACHER_ID,
      roles: ["TEACHER"],
      permissions: [],
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const denied = await inject({
      method: "POST",
      url: "/api/v1/gate-events/check-in",
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");

    const csrfRejected = await inject({
      method: "POST",
      url: "/api/v1/gate-events/check-in",
      csrf: false,
      payload: {},
    });
    expect(csrfRejected.statusCode).toBe(403);
    expect(csrfRejected.json().error.code).toBe("CSRF_INVALID");
    expect(service.createGateCheckIn).not.toHaveBeenCalled();
  });

  it("rejects non-calendar event timestamps", async () => {
    const response = await inject({
      method: "POST",
      url: "/api/v1/gate-events/check-in",
      payload: {
        studentId: STUDENT_ID,
        eventAt: "2026-02-30T07:05:00.000Z",
        clientEventId: "invalid-date",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BAD_REQUEST");
    expect(service.createGateCheckIn).not.toHaveBeenCalled();
  });

  it("scopes roster reads to authenticated tenant and requires teacher profile to mark", async () => {
    const roster = await inject({
      method: "GET",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/student-roster`,
    });
    expect(roster.statusCode).toBe(200);
    expect(service.getStudentRoster).toHaveBeenCalledWith(
      INSTITUTION_ID,
      SESSION_ID,
    );

    authSessionService.validateSession.mockImplementationOnce(async () => ({
      sessionId: "auth-session-id",
      userId: "user-id",
      institutionId: INSTITUTION_ID,
      teacherId: null,
      roles: ["STAFF"],
      permissions: allPermissions,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const response = await inject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/student-attendance`,
      payload: { studentId: STUDENT_ID },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TEACHER_PROFILE_REQUIRED");
    expect(service.markStudentPresent).not.toHaveBeenCalled();
  });
});
