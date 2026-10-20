import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { AttendanceSessionService } from "./attendance-session.service.js";

import {
  createAttendanceSessionLifecycleFixture,
  type AttendanceSessionLifecycleFixture,
} from "./attendance-session.lifecycle.test.fixture.js";

import { closeTestDb, testPrisma } from "../../test/db.js";

const service = new AttendanceSessionService();

let fixture: AttendanceSessionLifecycleFixture;

beforeAll(async () => {
  fixture =
    await createAttendanceSessionLifecycleFixture();
});

afterAll(async () => {
  await fixture?.cleanup();
  await closeTestDb();
});

describe("AttendanceSessionService lifecycle - Gate A/B", () => {
  it("AS-006: creates AttendanceSession as OPEN with snapshots and no segment", async () => {
    const session =
      await service.createSession({
        institutionId: fixture.institutionId,
        scheduleId: fixture.scheduleId,
        sessionDate: fixture.sessionDate,
      });

    expect(session.status).toBe("OPEN");
    expect(session.institutionId).toBe(fixture.institutionId);
    expect(session.scheduleId).toBe(fixture.scheduleId);
    expect(session.sessionDate).toEqual(fixture.sessionDate);
    expect(session.primaryTeacherIdSnapshot).toBe(fixture.teacherId);
    expect(session.classIdSnapshot).toBe(fixture.classId);
    expect(session.subjectIdSnapshot).toBe(fixture.subjectId);
    expect(Number(session.scheduledJpSnapshot)).toBe(2);

    const segments =
      await testPrisma.attendanceSessionSegment.findMany({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
        },
      });

    expect(segments).toHaveLength(0);
  });

  it("AS-007: opens the first segment for the legitimate primary teacher", async () => {
    const existingSession =
      await testPrisma.attendanceSession.findUniqueOrThrow({
        where: {
          scheduleId_sessionDate: {
            scheduleId: fixture.scheduleId,
            sessionDate: fixture.sessionDate,
          },
        },
      });

    const startedAt =
      new Date("2026-09-25T07:00:00.000Z");

    const segment =
      await service.openSegment({
        institutionId: fixture.institutionId,
        sessionId: existingSession.id,
        teacherId: fixture.teacherId,
        startedAt,
      });

    expect(segment.status).toBe("OPEN");
    expect(segment.teacherId).toBe(fixture.teacherId);
    expect(segment.attendanceSessionId).toBe(existingSession.id);
    expect(segment.startedAt).toEqual(startedAt);
    expect(Number(segment.allocatedJp)).toBe(0);

    const openSegments =
      await testPrisma.attendanceSessionSegment.findMany({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: existingSession.id,
          status: "OPEN",
        },
      });

    expect(openSegments).toHaveLength(1);
  });

  it("AS-009: rejects opening a second OPEN segment", async () => {
    const existingSession =
      await testPrisma.attendanceSession.findUniqueOrThrow({
        where: {
          scheduleId_sessionDate: {
            scheduleId: fixture.scheduleId,
            sessionDate: fixture.sessionDate,
          },
        },
      });

    const secondStart =
      new Date("2026-09-25T07:10:00.000Z");

    await expect(
      service.openSegment({
        institutionId: fixture.institutionId,
        sessionId: existingSession.id,
        teacherId: fixture.teacherId,
        startedAt: secondStart,
      }),
    ).rejects.toThrow(
      "AttendanceSession already has an open segment",
    );

    const segments =
      await testPrisma.attendanceSessionSegment.findMany({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: existingSession.id,
        },
      });

    expect(segments).toHaveLength(1);
    expect(segments[0]?.status).toBe("OPEN");
    expect(segments[0]?.teacherId).toBe(fixture.teacherId);
  });

  it("AS-008: performs atomic handover from primary teacher to approved substitute", async () => {
    const existingSession =
      await testPrisma.attendanceSession.findUniqueOrThrow({
        where: {
          scheduleId_sessionDate: {
            scheduleId: fixture.scheduleId,
            sessionDate: fixture.sessionDate,
          },
        },
      });

    const handoverAt =
      new Date("2026-09-25T07:40:00.000Z");

    const newSegment =
      await service.handover({
        institutionId: fixture.institutionId,
        sessionId: existingSession.id,
        teacherId: fixture.substituteTeacherId,
        handoverAt,
        auditContext: {
          auth: {
            sessionId: "lifecycle-session",
            userId: fixture.approverUserId,
            institutionId: fixture.institutionId,
            teacherId: fixture.substituteTeacherId,
            roles: ["TEACHER"],
            permissions: [],
          },
          requestId: "lifecycle-handover-test",
          ipAddress: "127.0.0.1",
        },
      });

    expect(newSegment.status).toBe("OPEN");
    expect(newSegment.teacherId).toBe(
      fixture.substituteTeacherId,
    );
    expect(newSegment.attendanceSessionId).toBe(
      existingSession.id,
    );
    expect(newSegment.startedAt).toEqual(
      handoverAt,
    );

    const segments =
      await testPrisma.attendanceSessionSegment.findMany({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: existingSession.id,
        },
        orderBy: {
          startedAt: "asc",
        },
      });

    expect(segments).toHaveLength(2);

    expect(segments[0]?.teacherId).toBe(
      fixture.teacherId,
    );
    expect(segments[0]?.status).toBe("CLOSED");
    expect(segments[0]?.endedAt).toEqual(
      handoverAt,
    );

    expect(segments[1]?.teacherId).toBe(
      fixture.substituteTeacherId,
    );
    expect(segments[1]?.status).toBe("OPEN");
    expect(segments[1]?.startedAt).toEqual(
      handoverAt,
    );

    expect(
      segments.filter(
        (segment) => segment.status === "OPEN",
      ),
    ).toHaveLength(1);

    const sessionAfter =
      await testPrisma.attendanceSession.findUniqueOrThrow({
        where: {
          id_institutionId: {
            id: existingSession.id,
            institutionId: fixture.institutionId,
          },
        },
      });

    expect(sessionAfter.id).toBe(existingSession.id);
    expect(sessionAfter.status).toBe("OPEN");
  });
});
