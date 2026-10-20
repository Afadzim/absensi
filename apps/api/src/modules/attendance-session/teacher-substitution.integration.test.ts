import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { testPrisma } from "../../test/db.js";
import type { AuthContext } from "../auth/auth.context.js";
import { AttendanceSessionService } from "./attendance-session.service.js";
import {
  createAttendanceSessionHandoverFixture,
  type AttendanceSessionHandoverFixture,
} from "./attendance-session.handover.test.fixture.js";
import { TeacherSubstitutionService } from "./teacher-substitution.service.js";

const SESSION_DATE = new Date("2026-09-25T00:00:00.000Z");

describe("TeacherSubstitutionService integration", () => {
  let fixture: AttendanceSessionHandoverFixture;
  let service: TeacherSubstitutionService;
  let sessions: AttendanceSessionService;
  let context: {
    auth: AuthContext;
    requestId: string;
    ipAddress: string;
    userAgent: string;
  };

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
    service = new TeacherSubstitutionService();
    sessions = new AttendanceSessionService();
    context = {
      auth: {
        sessionId: "substitution-test-session",
        userId: fixture.userId,
        institutionId: fixture.institutionId,
        teacherId: null,
        roles: ["ADMIN"],
        permissions: [],
      },
      requestId: "substitution-integration-test",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    };
    await testPrisma.teacherSubstitution.deleteMany({
      where: {
        institutionId: fixture.institutionId,
        scheduleId: fixture.scheduleId,
      },
    });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function createInput(
    startTime: string,
    endTime: string,
    reason = "Approved substitute arrangement",
  ) {
    return {
      substitutionDate: SESSION_DATE,
      substituteTeacherId: fixture.substituteTeacherId,
      startTime: new Date(`1970-01-01T${startTime}:00.000Z`),
      endTime: new Date(`1970-01-01T${endTime}:00.000Z`),
      reason,
    };
  }

  it("requires explicit approval before substitute opens a segment; handover and finalization remain one learning unit", async () => {
    const pending = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:00", "07:40"),
    );
    expect(pending.status).toBe("PENDING");
    expect(pending.originalTeacherId).toBe(fixture.teacherId);
    expect(pending.approvedById).toBeNull();

    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    await expect(
      sessions.openSegment({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.substituteTeacherId,
        startedAt: new Date("2026-09-25T07:00:00.000Z"),
      }),
    ).rejects.toThrow("Teacher is not authorized to run this session");

    const approved = await service.approve(context, pending.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(fixture.userId);
    expect(approved.approvedAt).toBeInstanceOf(Date);

    await expect(
      sessions.openSegment({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.substituteTeacherId,
        startedAt: new Date("2026-09-26T07:00:00.000Z"),
      }),
    ).rejects.toThrow(
      "Substitute session segment must start on its approved substitution date.",
    );

    const incoming = await sessions.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.substituteTeacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });
    const primarySegment = await sessions.handover({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      handoverAt: new Date("2026-09-25T07:40:00.000Z"),
      auditContext: context,
    });
    expect(primarySegment.teacherId).toBe(fixture.teacherId);

    await sessions.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt: new Date("2026-09-25T08:20:00.000Z"),
      auditContext: context,
    });

    const segments = await testPrisma.attendanceSessionSegment.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
      orderBy: { startedAt: "asc" },
    });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      id: incoming.id,
      teacherId: fixture.substituteTeacherId,
      status: "CLOSED",
      endedAt: new Date("2026-09-25T07:40:00.000Z"),
    });
    expect(segments[1]).toMatchObject({
      teacherId: fixture.teacherId,
      status: "CLOSED",
      startedAt: new Date("2026-09-25T07:40:00.000Z"),
    });

    const attendances = await testPrisma.teacherAttendance.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
    });
    expect(
      Object.fromEntries(
        attendances.map(({ teacherId, status }) => [teacherId, status]),
      ),
    ).toEqual({
      [fixture.teacherId]: "HADIR",
      [fixture.substituteTeacherId]: "HADIR",
    });
    expect(
      await testPrisma.auditLog.count({
        where: {
          institutionId: fixture.institutionId,
          entity: {
            in: ["TeacherSubstitution", "AttendanceSessionSegment"],
          },
        },
      }),
    ).toBeGreaterThanOrEqual(4);
  });

  it("records an absent primary as ALPA when an approved substitute teaches without a primary segment", async () => {
    const pending = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:00", "08:20"),
    );
    await service.approve(context, pending.id);
    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    await sessions.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.substituteTeacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });
    await sessions.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt: new Date("2026-09-25T08:20:00.000Z"),
      auditContext: context,
    });

    const teacherAttendances = await testPrisma.teacherAttendance.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
    });
    expect(
      Object.fromEntries(
        teacherAttendances.map(({ teacherId, status }) => [teacherId, status]),
      ),
    ).toEqual({
      [fixture.teacherId]: "ALPA",
      [fixture.substituteTeacherId]: "HADIR",
    });
  });

  it("allows adjacent intervals, rejects overlaps, and enforces substitution state transitions", async () => {
    const first = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:00", "07:40", "Morning substitute"),
    );
    const second = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:40", "08:20", "Second segment substitute"),
    );
    await expect(
      service.create(
        context,
        fixture.scheduleId,
        createInput("07:30", "08:00", "Overlapping request"),
      ),
    ).rejects.toMatchObject({ name: "TeacherSubstitutionConflictError" });

    const listed = await service.list(
      fixture.institutionId,
      fixture.scheduleId,
      { page: 1, pageSize: 10, substitutionDate: SESSION_DATE },
    );
    expect(listed.total).toBe(2);
    expect(listed.data.map(({ id }) => id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );

    const rejected = await service.reject(context, first.id, "Not required");
    expect(rejected.status).toBe("REJECTED");
    await expect(
      service.approve(context, first.id),
    ).rejects.toMatchObject({ name: "TeacherSubstitutionConflictError" });

    const approved = await service.approve(context, second.id);
    expect(approved.status).toBe("APPROVED");
    const cancelled = await service.cancel(context, second.id, "Schedule changed");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("enforces tenant scope, schedule weekday, and schedule time bounds", async () => {
    await expect(
      service.create(
        {
          ...context,
          auth: {
            ...context.auth,
            institutionId: "11111111-1111-4111-8111-111111111111",
          },
        },
        fixture.scheduleId,
        createInput("07:00", "07:40"),
      ),
    ).rejects.toMatchObject({ name: "TeacherSubstitutionNotFoundError" });

    await expect(
      service.create(
        context,
        fixture.scheduleId,
        createInput("06:50", "07:40"),
      ),
    ).rejects.toMatchObject({ name: "TeacherSubstitutionInputError" });

    await expect(
      service.create(context, fixture.scheduleId, {
        ...createInput("07:00", "07:40"),
        substitutionDate: new Date("2026-09-26T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ name: "TeacherSubstitutionInputError" });
  });

  it("uses existing learning-unit snapshots instead of a later recurring-schedule edit", async () => {
    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    await testPrisma.schedule.update({
      where: {
        id_institutionId: {
          id: fixture.scheduleId,
          institutionId: fixture.institutionId,
        },
      },
      data: {
        dayOfWeek: 6,
        startPeriodNumber: 2,
        endPeriodNumber: 2,
      },
    });

    const pending = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:00", "07:40"),
    );

    expect(pending.status).toBe("PENDING");
    expect(pending.originalTeacherId).toBe(
      session.primaryTeacherIdSnapshot,
    );
  });

  it("does not permit handover after an approved interval and clips late finalization to authorization", async () => {
    const substitution = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:00", "07:40"),
    );
    await service.approve(context, substitution.id);
    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    await sessions.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.substituteTeacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });

    await expect(
      sessions.handover({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.teacherId,
        handoverAt: new Date("2026-09-25T07:41:00.000Z"),
        auditContext: context,
      }),
    ).rejects.toThrow(
      "Substitute segment cannot continue beyond its approved substitution interval.",
    );
    expect(
      await testPrisma.attendanceSessionSegment.count({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
          status: "OPEN",
        },
      }),
    ).toBe(1);

    await sessions.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt: new Date("2026-09-25T07:50:00.000Z"),
      auditContext: context,
    });
    const segment = await testPrisma.attendanceSessionSegment.findFirstOrThrow({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
    });
    expect(segment.endedAt).toEqual(
      new Date("2026-09-25T07:40:00.000Z"),
    );
    const substituteAttendance =
      await testPrisma.teacherAttendance.findUniqueOrThrow({
        where: {
          attendanceSessionId_teacherId: {
            attendanceSessionId: session.id,
            teacherId: fixture.substituteTeacherId,
          },
        },
      });
    expect(Number(substituteAttendance.allocatedJp)).toBe(1);
  });

  it("prevents cancellation after the substitute has opened a session segment", async () => {
    const substitution = await service.create(
      context,
      fixture.scheduleId,
      createInput("07:00", "08:20"),
    );
    await service.approve(context, substitution.id);
    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    await sessions.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.substituteTeacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });

    await expect(
      service.cancel(context, substitution.id),
    ).rejects.toMatchObject({ name: "TeacherSubstitutionConflictError" });
  });
});
