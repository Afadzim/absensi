import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { testPrisma } from "../../test/db.js";
import type { AuthContext } from "../auth/auth.context.js";
import { AttendanceEngineService } from "./attendance-engine.service.js";
import { AttendanceSessionService } from "./attendance-session.service.js";
import {
  createAttendanceSessionHandoverFixture,
  type AttendanceSessionHandoverFixture,
} from "./attendance-session.handover.test.fixture.js";

const SESSION_DATE = new Date("2026-09-25T00:00:00.000Z");

describe("AttendanceEngineService integration", () => {
  let fixture: AttendanceSessionHandoverFixture;
  let engine: AttendanceEngineService;
  let sessions: AttendanceSessionService;
  let context: {
    auth: AuthContext;
    requestId: string;
    ipAddress: string;
    userAgent: string;
  };

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
    engine = new AttendanceEngineService();
    sessions = new AttendanceSessionService(engine);
    context = {
      auth: {
        sessionId: "test-session",
        userId: fixture.userId,
        institutionId: fixture.institutionId,
        teacherId: fixture.teacherId,
        roles: ["TEACHER"],
        permissions: [],
      },
      requestId: "attendance-engine-test",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    };
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  async function createStudent(code: string, name = code): Promise<string> {
    const student = await testPrisma.student.create({
      data: {
        institutionId: fixture.institutionId,
        code,
        name,
      },
    });
    await testPrisma.studentClassEnrollment.create({
      data: {
        institutionId: fixture.institutionId,
        studentId: student.id,
        classId: fixture.classId,
        academicYearId: fixture.academicYearId,
        validFrom: SESSION_DATE,
      },
    });
    return student.id;
  }

  it("enforces gate idempotency, roster eligibility, marking, and final attendance", async () => {
    const [
      presentStudentId,
      unmarkedStudentId,
      adminStudentId,
      adminAndGateStudentId,
      absentStudentId,
    ] =
      await Promise.all([
        createStudent("PRESENT"),
        createStudent("UNMARKED"),
        createStudent("ADMIN"),
        createStudent("ADMIN-AND-GATE"),
        createStudent("ABSENT"),
      ]);
    const presentInput = {
      studentId: presentStudentId,
      eventAt: new Date("2026-09-25T07:05:00.000Z"),
      clientEventId: "gate-event-present",
    };
    const firstCheckIn = await engine.createGateCheckIn(context, presentInput);
    const retryCheckIn = await engine.createGateCheckIn(context, presentInput);
    expect(firstCheckIn.duplicate).toBe(false);
    expect(retryCheckIn.duplicate).toBe(true);
    expect(retryCheckIn.data.id).toBe(firstCheckIn.data.id);

    await expect(
      engine.createGateCheckIn(context, {
        ...presentInput,
        studentId: unmarkedStudentId,
      }),
    ).rejects.toMatchObject({ name: "AttendanceConflictError" });

    await engine.createGateCheckIn(context, {
      studentId: unmarkedStudentId,
      eventAt: new Date("2026-09-25T07:06:00.000Z"),
      clientEventId: "gate-event-unmarked",
    });
    await engine.createGateCheckIn(context, {
      studentId: adminAndGateStudentId,
      eventAt: new Date("2026-09-25T07:07:00.000Z"),
      clientEventId: "gate-event-admin-and-gate",
    });
    await engine.createStudentAdministrativeStatus(context, {
      studentId: adminStudentId,
      type: "SAKIT",
      validFrom: SESSION_DATE,
      validTo: SESSION_DATE,
      reason: "Verified sick leave",
    });
    await engine.createStudentAdministrativeStatus(context, {
      studentId: adminAndGateStudentId,
      type: "IZIN",
      validFrom: SESSION_DATE,
      validTo: SESSION_DATE,
      reason: "Original administrative status is retained",
    });

    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    const roster = await engine.getStudentRoster(
      fixture.institutionId,
      session.id,
    );
    expect(roster.map(({ studentId }) => studentId)).toEqual(
      expect.arrayContaining([
        presentStudentId,
        unmarkedStudentId,
        adminStudentId,
        adminAndGateStudentId,
      ]),
    );
    expect(roster).toHaveLength(4);
    expect(
      roster.find(({ studentId }) => studentId === adminStudentId),
    ).toMatchObject({
      gateCheckedIn: false,
      effectiveStatus: "SAKIT",
      canCheck: false,
    });
    expect(
      roster.find(({ studentId }) => studentId === adminAndGateStudentId),
    ).toMatchObject({
      gateCheckedIn: true,
      administrativeStatus: "IZIN",
      effectiveStatus: "NORMAL",
      canCheck: true,
    });

    await sessions.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });
    const marked = await engine.markStudentPresent(
      context,
      session.id,
      presentStudentId,
      fixture.teacherId,
    );
    const repeatedMark = await engine.markStudentPresent(
      context,
      session.id,
      presentStudentId,
      fixture.teacherId,
    );
    expect(repeatedMark.id).toBe(marked.id);
    await engine.markStudentPresent(
      context,
      session.id,
      adminAndGateStudentId,
      fixture.teacherId,
    );

    await sessions.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt: new Date("2026-09-25T08:20:00.000Z"),
      auditContext: context,
    });

    const studentAttendance = await testPrisma.studentAttendance.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
    });
    expect(
      Object.fromEntries(
        studentAttendance.map(({ studentId, status }) => [studentId, status]),
      ),
    ).toEqual({
      [presentStudentId]: "HADIR",
      [unmarkedStudentId]: "ALPA",
      [adminStudentId]: "SAKIT",
      [adminAndGateStudentId]: "HADIR",
    });
    expect(
      studentAttendance.some(({ studentId }) => studentId === absentStudentId),
    ).toBe(false);

    const teacherAttendance =
      await testPrisma.teacherAttendance.findUniqueOrThrow({
        where: {
          attendanceSessionId_teacherId: {
            attendanceSessionId: session.id,
            teacherId: fixture.teacherId,
          },
        },
      });
    expect(teacherAttendance).toMatchObject({
      status: "HADIR",
    });
    expect(Number(teacherAttendance.assignedJp)).toBe(2);
    expect(Number(teacherAttendance.allocatedJp)).toBe(2);
    expect(
      await testPrisma.auditLog.count({
        where: {
          institutionId: fixture.institutionId,
          entity: { in: ["GateEvent", "StudentAttendance", "TeacherAttendance"] },
        },
      }),
    ).toBeGreaterThanOrEqual(5);

    const raceStudentId = await createStudent("RACE");
    const concurrentResults = await Promise.all([
      engine.createGateCheckIn(context, {
        studentId: raceStudentId,
        eventAt: new Date("2026-09-25T07:07:00.000Z"),
        clientEventId: "gate-event-concurrent",
      }),
      engine.createGateCheckIn(context, {
        studentId: raceStudentId,
        eventAt: new Date("2026-09-25T07:07:00.000Z"),
        clientEventId: "gate-event-concurrent",
      }),
    ]);
    expect(concurrentResults.map(({ duplicate }) => duplicate).sort()).toEqual([
      false,
      true,
    ]);
  });

  it("assigns early-morning gate events to the institutional calendar date", async () => {
    const studentId = await createStudent("LOCAL-DATE");
    const result = await engine.createGateCheckIn(context, {
      studentId,
      eventAt: new Date("2026-09-24T18:30:00.000Z"),
      clientEventId: "gate-event-local-date",
    });

    expect(result.data.eventDate).toEqual(SESSION_DATE);
  });

  it("allocates only scheduled JP minutes to each teacher across a handover", async () => {
    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });
    await sessions.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date("2026-09-25T06:30:00.000Z"),
    });
    await sessions.handover({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.substituteTeacherId,
      handoverAt: new Date("2026-09-25T07:40:00.000Z"),
      auditContext: context,
    });
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
    expect(segments.map(({ allocatedJp }) => Number(allocatedJp))).toEqual([
      1,
      1,
    ]);

    const rows = await testPrisma.teacherAttendance.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map(({ status }) => status)).toEqual(["HADIR", "HADIR"]);
    expect(rows.map(({ allocatedJp }) => Number(allocatedJp))).toEqual([
      1,
      1,
    ]);
    expect(rows.every(({ assignedJp }) => Number(assignedJp) === 2)).toBe(true);
  });

  it("does not create student attendance without a valid learning segment", async () => {
    const studentId = await createStudent("NO-SESSION");
    await engine.createGateCheckIn(context, {
      studentId,
      eventAt: new Date("2026-09-25T07:05:00.000Z"),
      clientEventId: "gate-no-session",
    });
    const session = await sessions.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: SESSION_DATE,
    });

    await sessions.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt: new Date("2026-09-25T08:20:00.000Z"),
      auditContext: context,
    });

    expect(
      await testPrisma.studentAttendance.count({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
        },
      }),
    ).toBe(0);
    expect(
      await testPrisma.studentAttendance.findFirst({
        where: { institutionId: fixture.institutionId, studentId },
      }),
    ).toBeNull();
    const teacherAttendance =
      await testPrisma.teacherAttendance.findUniqueOrThrow({
        where: {
          attendanceSessionId_teacherId: {
            attendanceSessionId: session.id,
            teacherId: fixture.teacherId,
          },
        },
      });
    expect(teacherAttendance.status).toBe("ALPA");
  });

  it("rejects overlapping administrative status ranges", async () => {
    const studentId = await createStudent("OVERLAP");
    await engine.createStudentAdministrativeStatus(context, {
      studentId,
      type: "IZIN",
      validFrom: new Date("2026-09-20T00:00:00.000Z"),
      validTo: new Date("2026-09-25T00:00:00.000Z"),
    });

    await expect(
      engine.createStudentAdministrativeStatus(context, {
        studentId,
        type: "SAKIT",
        validFrom: SESSION_DATE,
        validTo: new Date("2026-09-26T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ name: "AttendanceConflictError" });
  });

  it("does not allow a tenant to check in or classify another tenant's student", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const otherInstitution = await testPrisma.institution.create({
      data: {
        code: `OTHER-${suffix}`,
        name: `Other tenant ${suffix}`,
      },
    });
    const foreignStudent = await testPrisma.student.create({
      data: {
        institutionId: otherInstitution.id,
        code: `FOREIGN-${suffix}`,
        name: "Foreign tenant student",
      },
    });

    try {
      await expect(
        engine.createGateCheckIn(context, {
          studentId: foreignStudent.id,
          eventAt: new Date("2026-09-25T07:05:00.000Z"),
          clientEventId: `foreign-${suffix}`,
        }),
      ).rejects.toMatchObject({ name: "AttendanceNotFoundError" });
      await expect(
        engine.createStudentAdministrativeStatus(context, {
          studentId: foreignStudent.id,
          type: "SAKIT",
          validFrom: SESSION_DATE,
        }),
      ).rejects.toMatchObject({ name: "AttendanceNotFoundError" });
    } finally {
      await testPrisma.student.delete({ where: { id: foreignStudent.id } });
      await testPrisma.institution.delete({
        where: { id: otherInstitution.id },
      });
    }
  });
});
