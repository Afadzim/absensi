import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AttendanceSessionService } from "./attendance-session.service.js";
import type { AuthSessionService } from "../auth/auth.session.service.js";
import { buildApp } from "../../app.js";

const INSTITUTION_ID =
  "11111111-1111-4111-8111-111111111111";

const TEACHER_ID =
  "22222222-2222-4222-8222-222222222222";

const SESSION_ID =
  "33333333-3333-4333-8333-333333333333";

const SCHEDULE_ID =
  "44444444-4444-4444-8444-444444444444";

const SESSION_TOKEN = "a".repeat(43);
const CSRF_TOKEN = "b".repeat(43);

function createAuthSessionServiceMock() {
  return {
    validateSession: vi.fn().mockResolvedValue({
      sessionId: "session-id",
      userId: "user-id",
      institutionId: INSTITUTION_ID,
      teacherId: TEACHER_ID,
      roles: ["TEACHER"],
      permissions: [
        "attendance.session.create",
        "attendance.session.open",
        "attendance.session.handover",
        "attendance.session.finalize",
        "attendance.session.cancel",
      ],
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }),
    verifyCsrfToken: vi.fn().mockResolvedValue(true),
  };
}

function createServiceMock() {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: SESSION_ID,
      status: "OPEN",
    }),

    openSegment: vi.fn().mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      status: "OPEN",
    }),

    handover: vi.fn().mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
      status: "OPEN",
    }),

    finalize: vi.fn().mockResolvedValue({
      id: SESSION_ID,
      status: "FINALIZED",
    }),

    cancel: vi.fn().mockResolvedValue({
      id: SESSION_ID,
      status: "CANCELLED",
    }),

    autoFinalizeExpiredSession: vi.fn(),
  };
}

describe("AttendanceSession HTTP routes", () => {
  let service: ReturnType<typeof createServiceMock>;
  let authSessionService: ReturnType<
    typeof createAuthSessionServiceMock
  >;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    service = createServiceMock();
    authSessionService = createAuthSessionServiceMock();
    app = buildApp({
      attendanceSessionService:
        service as unknown as AttendanceSessionService,
      authSessionService:
        authSessionService as unknown as AuthSessionService,
    });
  });

  function authenticatedInject(options: {
    method: "POST" | "GET";
    url: string;
    headers?: Record<string, string>;
    payload?: string | object | Buffer | NodeJS.ReadableStream;
  }) {
    return app.inject({
      ...options,
      cookies: {
        "__Host-am_session": SESSION_TOKEN,
        "__Host-am_csrf": CSRF_TOKEN,
      },
      headers: {
        "x-csrf-token": CSRF_TOKEN,
        ...options.headers,
      },
    });
  }

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("POST /api/v1/attendance-sessions -> 201", async () => {
    const beforeRequest = new Date();

    const response = await authenticatedInject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      headers: {
        "x-institution-id": "99999999-9999-4999-8999-999999999999",
        "content-type": "application/json",
      },
      payload: {
        scheduleId: SCHEDULE_ID,
        sessionDate:
          "2026-09-25T00:00:00.000Z",
      },
    });

    const afterRequest = new Date();

    expect(response.statusCode).toBe(201);

    expect(response.json()).toEqual({
      data: {
        id: SESSION_ID,
        status: "OPEN",
      },
    });

    expect(service.createSession)
      .toHaveBeenCalledTimes(1);

    const input =
      service.createSession.mock.calls[0][0];

    expect(input.institutionId).toBe(
      INSTITUTION_ID,
    );

    expect(input.scheduleId).toBe(
      SCHEDULE_ID,
    );

    expect(input.sessionDate).toEqual(
      new Date("2026-09-25T00:00:00.000Z"),
    );

    expect(input.sessionDate).not.toBe(
      undefined,
    );

    expect(
      input.sessionDate.getTime(),
    ).toBe(
      new Date(
        "2026-09-25T00:00:00.000Z",
      ).getTime(),
    );

    expect(
      beforeRequest.getTime(),
    ).toBeLessThanOrEqual(
      afterRequest.getTime(),
    );
  });

  it("POST create mengambil institution dari AuthContext, bukan header klien", async () => {
    const response = await authenticatedInject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      headers: {
        "content-type": "application/json",
      },
      payload: {
        scheduleId: SCHEDULE_ID,
        sessionDate:
          "2026-09-25T00:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ institutionId: INSTITUTION_ID }),
    );
  });

  it("POST create menolak session yang tidak terautentikasi", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      payload: {
        scheduleId: SCHEDULE_ID,
        sessionDate: "2026-09-25T00:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("POST create menolak user tanpa permission", async () => {
    authSessionService.validateSession.mockResolvedValueOnce({
      sessionId: "session-id",
      userId: "user-id",
      institutionId: INSTITUTION_ID,
      teacherId: TEACHER_ID,
      roles: [],
      permissions: [],
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await authenticatedInject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      payload: {
        scheduleId: SCHEDULE_ID,
        sessionDate: "2026-09-25T00:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("POST create menolak CSRF token yang tidak valid", async () => {
    authSessionService.verifyCsrfToken.mockResolvedValueOnce(false);

    const response = await authenticatedInject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      payload: {
        scheduleId: SCHEDULE_ID,
        sessionDate: "2026-09-25T00:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CSRF_INVALID");
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("POST create menolak UUID jadwal tidak valid", async () => {
    const response = await authenticatedInject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      headers: {
        "content-type": "application/json",
      },
      payload: {
        scheduleId: "not-a-uuid",
        sessionDate:
          "2026-09-25T00:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("POST /open menggunakan waktu server", async () => {
    const beforeRequest = new Date();

    const response = await authenticatedInject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/open`,
      headers: {
        "x-institution-id": INSTITUTION_ID,
        "x-teacher-id": TEACHER_ID,
      },
    });

    const afterRequest = new Date();

    expect(response.statusCode).toBe(200);

    expect(service.openSegment)
      .toHaveBeenCalledTimes(1);

    const input =
      service.openSegment.mock.calls[0][0];

    expect(input).toMatchObject({
      institutionId: INSTITUTION_ID,
      sessionId: SESSION_ID,
      teacherId: TEACHER_ID,
    });

    expect(input.startedAt).toBeInstanceOf(Date);

    expect(input.startedAt.getTime())
      .toBeGreaterThanOrEqual(
        beforeRequest.getTime(),
      );

    expect(input.startedAt.getTime())
      .toBeLessThanOrEqual(
        afterRequest.getTime(),
      );
  });

  it("POST /handover menggunakan waktu server", async () => {
    const beforeRequest = new Date();

    const response = await authenticatedInject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/handover`,
      headers: {
        "x-institution-id": INSTITUTION_ID,
        "x-teacher-id": TEACHER_ID,
      },
    });

    const afterRequest = new Date();

    expect(response.statusCode).toBe(200);

    expect(service.handover)
      .toHaveBeenCalledTimes(1);

    const input =
      service.handover.mock.calls[0][0];

    expect(input).toMatchObject({
      institutionId: INSTITUTION_ID,
      sessionId: SESSION_ID,
      teacherId: TEACHER_ID,
    });

    expect(input.handoverAt)
      .toBeInstanceOf(Date);

    expect(input.handoverAt.getTime())
      .toBeGreaterThanOrEqual(
        beforeRequest.getTime(),
      );

    expect(input.handoverAt.getTime())
      .toBeLessThanOrEqual(
        afterRequest.getTime(),
      );
  });

  it("POST /finalize menggunakan waktu server", async () => {
    const beforeRequest = new Date();

    const response = await authenticatedInject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/finalize`,
      headers: {
        "x-institution-id": INSTITUTION_ID,
      },
    });

    const afterRequest = new Date();

    expect(response.statusCode).toBe(200);

    expect(service.finalize)
      .toHaveBeenCalledTimes(1);

    const input =
      service.finalize.mock.calls[0][0];

    expect(input).toMatchObject({
      institutionId: INSTITUTION_ID,
      sessionId: SESSION_ID,
    });

    expect(input.finalizedAt)
      .toBeInstanceOf(Date);

    expect(input.finalizedAt.getTime())
      .toBeGreaterThanOrEqual(
        beforeRequest.getTime(),
      );

    expect(input.finalizedAt.getTime())
      .toBeLessThanOrEqual(
        afterRequest.getTime(),
      );
  });

  it("POST /cancel menggunakan waktu server", async () => {
    const beforeRequest = new Date();

    const response = await authenticatedInject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/cancel`,
      headers: {
        "x-institution-id": INSTITUTION_ID,
      },
    });

    const afterRequest = new Date();

    expect(response.statusCode).toBe(200);

    expect(service.cancel)
      .toHaveBeenCalledTimes(1);

    const input =
      service.cancel.mock.calls[0][0];

    expect(input).toMatchObject({
      institutionId: INSTITUTION_ID,
      sessionId: SESSION_ID,
    });

    expect(input.cancelledAt)
      .toBeInstanceOf(Date);

    expect(input.cancelledAt.getTime())
      .toBeGreaterThanOrEqual(
        beforeRequest.getTime(),
      );

    expect(input.cancelledAt.getTime())
      .toBeLessThanOrEqual(
        afterRequest.getTime(),
      );
  });

  it("domain error Schedule not found -> 404", async () => {
    service.createSession.mockRejectedValueOnce(
      new Error("Schedule not found"),
    );

    const response = await authenticatedInject({
      method: "POST",
      url: "/api/v1/attendance-sessions",
      headers: {
        "x-institution-id": INSTITUTION_ID,
        "content-type": "application/json",
      },
      payload: {
        scheduleId: SCHEDULE_ID,
        sessionDate:
          "2026-09-25T00:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(404);

    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Schedule not found",
      },
    });
  });

  it("domain error AttendanceSession not found -> 404", async () => {
    service.finalize.mockRejectedValueOnce(
      new Error("AttendanceSession not found"),
    );

    const response = await authenticatedInject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/finalize`,
      headers: {
        "x-institution-id": INSTITUTION_ID,
      },
    });

    expect(response.statusCode).toBe(404);

    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "AttendanceSession not found",
      },
    });
  });

  it("route yang tidak tersedia tidak mengekspos auto-finalize", async () => {
    const response = await authenticatedInject({
      method: "POST",
      url: `/api/v1/attendance-sessions/${SESSION_ID}/auto-finalize`,
      headers: {
        "x-institution-id": INSTITUTION_ID,
      },
    });

    expect(response.statusCode).toBe(404);

    expect(
      service.autoFinalizeExpiredSession,
    ).not.toHaveBeenCalled();
  });

  it("health endpoint tetap tersedia", async () => {
    const response = await authenticatedInject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toEqual({
      status: "ok",
      service: "absensi-madrasah-api",
    });
  });
});