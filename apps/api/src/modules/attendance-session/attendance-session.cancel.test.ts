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

describe("AttendanceSessionService - cancel", () => {
  let fixture: AttendanceSessionHandoverFixture;

  const service = new AttendanceSessionService();

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("AS-012: cancel menutup session OPEN dan menghilangkan alokasi JP", async () => {
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

    const cancelledAt = new Date(
      "2026-09-25T07:20:00.000Z",
    );

    const cancelledSession = await service.cancel({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      cancelledAt,
    });

    expect(cancelledSession.id).toBe(session.id);
    expect(cancelledSession.status).toBe("CANCELLED");
    expect(cancelledSession.cancelledAt).toEqual(cancelledAt);
    expect(cancelledSession.finalizedAt).toBeNull();

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
    expect(persistedSegment.endedAt).toEqual(cancelledAt);
    expect(Number(persistedSegment.allocatedJp)).toBe(0);

    const allocatedJp =
      await prisma.attendanceSessionSegment.aggregate({
        where: {
          institutionId: fixture.institutionId,
          attendanceSessionId: session.id,
        },
        _sum: {
          allocatedJp: true,
        },
      });

    expect(Number(allocatedJp._sum.allocatedJp ?? 0)).toBe(0);

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
