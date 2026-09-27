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

describe("AttendanceSessionService - finalize", () => {
  let fixture: AttendanceSessionHandoverFixture;

  const service = new AttendanceSessionService();

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("AS-010: finalize menutup segment OPEN dan mengubah session menjadi FINALIZED", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const startedAt = new Date("2026-09-25T07:00:00.000Z");
    const finalizedAt = new Date("2026-09-25T07:40:00.000Z");

    const segment = await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt,
    });

    const finalizedSession = await service.finalize({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      finalizedAt,
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
