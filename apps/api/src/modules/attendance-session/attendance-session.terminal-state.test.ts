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

describe("AttendanceSessionService - terminal state protection", () => {
  let fixture: AttendanceSessionHandoverFixture;

  const service = new AttendanceSessionService();

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("AS-014: FINALIZED tidak dapat berubah menjadi CANCELLED", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });

    const finalizedAt = new Date(
      "2026-09-25T08:00:00.000Z",
    );

    await service.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt,
    });

    await expect(
      service.cancel({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        cancelledAt: new Date(
          "2026-09-25T08:05:00.000Z",
        ),
      }),
    ).rejects.toThrow(
      "AttendanceSession is not OPEN",
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

    expect(persistedSession.status).toBe("FINALIZED");
    expect(persistedSession.finalizedAt).toEqual(finalizedAt);
    expect(persistedSession.cancelledAt).toBeNull();
  });
  it("AS-015: CANCELLED tidak dapat kembali menjadi OPEN", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const startedAt = new Date(
      "2026-09-25T07:00:00.000Z",
    );

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt,
    });

    const cancelledAt = new Date(
      "2026-09-25T07:20:00.000Z",
    );

    await service.cancel({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      cancelledAt,
    });

    await expect(
      service.openSegment({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.teacherId,
        startedAt: new Date(
          "2026-09-25T07:25:00.000Z",
        ),
      }),
    ).rejects.toThrow(
      "AttendanceSession is not OPEN",
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

    expect(persistedSession.status).toBe("CANCELLED");
    expect(persistedSession.cancelledAt).toEqual(cancelledAt);
    expect(persistedSession.finalizedAt).toBeNull();
  });
  it("AS-016: CANCELLED tidak dapat berubah menjadi FINALIZED", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date(
        "2026-09-25T07:00:00.000Z",
      ),
    });

    const cancelledAt = new Date(
      "2026-09-25T07:20:00.000Z",
    );

    await service.cancel({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      cancelledAt,
    });

    await expect(
      service.finalize({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        finalizedAt: new Date(
          "2026-09-25T08:00:00.000Z",
        ),
      }),
    ).rejects.toThrow(
      "AttendanceSession is not OPEN",
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

    expect(persistedSession.status).toBe("CANCELLED");
    expect(persistedSession.cancelledAt).toEqual(cancelledAt);
    expect(persistedSession.finalizedAt).toBeNull();
  });
  it("AS-017: FINALIZED tidak dapat melakukan handover", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date(
        "2026-09-25T07:00:00.000Z",
      ),
    });

    await service.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt: new Date(
        "2026-09-25T08:00:00.000Z",
      ),
    });

    await expect(
      service.handover({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.substituteTeacherId,
        handoverAt: new Date(
          "2026-09-25T08:05:00.000Z",
        ),
      }),
    ).rejects.toThrow(
      "AttendanceSession is not OPEN",
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

    expect(persistedSession.status).toBe("FINALIZED");

    const segments =
      await prisma.attendanceSessionSegment.findMany({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
        },
        orderBy: {
          startedAt: "asc",
        },
      });

    expect(segments).toHaveLength(1);
    expect(segments[0].status).toBe("CLOSED");
    expect(segments[0].teacherId).toBe(fixture.teacherId);
  });
  it("AS-018: CANCELLED tidak dapat membuka segment baru", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date(
        "2026-09-25T07:00:00.000Z",
      ),
    });

    const cancelledAt = new Date(
      "2026-09-25T07:20:00.000Z",
    );

    await service.cancel({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      cancelledAt,
    });

    await expect(
      service.openSegment({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.substituteTeacherId,
        startedAt: new Date(
          "2026-09-25T07:25:00.000Z",
        ),
      }),
    ).rejects.toThrow(
      "AttendanceSession is not OPEN",
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

    expect(persistedSession.status).toBe("CANCELLED");
    expect(persistedSession.cancelledAt).toEqual(cancelledAt);
    expect(persistedSession.finalizedAt).toBeNull();

    const segments =
      await prisma.attendanceSessionSegment.findMany({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
        },
      });

    expect(segments).toHaveLength(1);
    expect(segments[0].status).toBe("CLOSED");
    expect(segments[0].teacherId).toBe(fixture.teacherId);
  });
  it("AS-013: FINALIZED tidak dapat kembali menjadi OPEN", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });

    const finalizedAt = new Date(
      "2026-09-25T08:00:00.000Z",
    );

    await service.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt,
    });

    const finalizedSession =
      await prisma.attendanceSession.findUniqueOrThrow({
        where: {
          id_institutionId: {
            id: session.id,
            institutionId: fixture.institutionId,
          },
        },
      });

    expect(finalizedSession.status).toBe("FINALIZED");

    await expect(
      service.openSegment({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.teacherId,
        startedAt: new Date("2026-09-25T08:05:00.000Z"),
      }),
    ).rejects.toThrow(
      "AttendanceSession is not OPEN",
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

    expect(persistedSession.status).toBe("FINALIZED");
  });
});





