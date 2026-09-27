import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { prisma } from "../../lib/prisma.js";
import { AttendanceSessionService } from "./attendance-session.service.js";
import {
  createAttendanceSessionHandoverFixture,
  type AttendanceSessionHandoverFixture,
} from "./attendance-session.handover.test.fixture.js";

describe("AttendanceSessionService - auto finalize", () => {
  let fixture: AttendanceSessionHandoverFixture;

  const service = new AttendanceSessionService();

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("AS-011-B: auto-finalize sebelum end time ditolak", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const startedAt = new Date("2026-09-25T07:00:00.000Z");

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt,
    });

    const beforeEndTime = new Date(
      "2026-09-25T08:19:59.000Z",
    );

    await expect(
      service.autoFinalizeExpiredSession({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        now: beforeEndTime,
      }),
    ).rejects.toThrow(
      "AttendanceSession has not reached its scheduled end time",
    );

    const persistedSession =
      await prisma.attendanceSession.findUniqueOrThrow({
        where: {
          id_institutionId: {
            id: session.id,
            institutionId: fixture.institutionId,
          },
        },
      });

    expect(persistedSession.status).toBe("OPEN");
    expect(persistedSession.finalizedAt).toBeNull();

    const openSegments =
      await prisma.attendanceSessionSegment.count({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
          status: "OPEN",
        },
      });

    expect(openSegments).toBe(1);
  });
  it("AS-011-C: auto-finalize terlambat tetap menutup segment pada end time jadwal", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const startedAt = new Date("2026-09-25T07:00:00.000Z");

    const segment = await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt,
    });

    const lateAutoFinalizeAt = new Date(
      "2026-09-25T08:25:00.000Z",
    );

    const finalizedSession =
      await service.autoFinalizeExpiredSession({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        now: lateAutoFinalizeAt,
      });

    expect(finalizedSession.status).toBe("FINALIZED");
    expect(finalizedSession.finalizedAt).toEqual(
      lateAutoFinalizeAt,
    );

    const persistedSegment =
      await prisma.attendanceSessionSegment.findUniqueOrThrow({
        where: {
          id_institutionId: {
            id: segment.id,
            institutionId: fixture.institutionId,
          },
        },
      });

    expect(persistedSegment.status).toBe("CLOSED");

    // Session berakhir pada batas jadwal 08:20,
    // bukan pada waktu scheduler terlambat berjalan 08:25.
    expect(persistedSegment.endedAt).toEqual(
      new Date("2026-09-25T08:20:00.000Z"),
    );
  });
  it("AS-011: auto-finalize menutup session yang sudah melewati endTimeSnapshot", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const startedAt = new Date("2026-09-25T07:00:00.000Z");

    const segment = await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt,
    });

    expect(session.status).toBe("OPEN");
    expect(session.endTimeSnapshot).toEqual(
      new Date("1970-01-01T08:20:00.000Z"),
    );

    const finalizedAt = new Date("2026-09-25T08:20:00.000Z");

    const finalizedSession =
      await service.autoFinalizeExpiredSession({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        now: finalizedAt,
      });

    expect(finalizedSession.id).toBe(session.id);
    expect(finalizedSession.status).toBe("FINALIZED");
    expect(finalizedSession.finalizedAt).toEqual(finalizedAt);
    expect(finalizedSession.cancelledAt).toBeNull();

    const persistedSegment =
      await prisma.attendanceSessionSegment.findUniqueOrThrow({
        where: {
          id_institutionId: {
            id: segment.id,
            institutionId: fixture.institutionId,
          },
        },
      });

    expect(persistedSegment.status).toBe("CLOSED");
    expect(persistedSegment.endedAt).toEqual(finalizedAt);

    const openSegments =
      await prisma.attendanceSessionSegment.count({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
          status: "OPEN",
        },
      });

    expect(openSegments).toBe(0);
  });
});


