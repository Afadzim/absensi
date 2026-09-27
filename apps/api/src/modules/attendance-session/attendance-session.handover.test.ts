import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { AttendanceSessionService } from "./attendance-session.service.js";
import {
  createAttendanceSessionHandoverFixture,
  type AttendanceSessionHandoverFixture,
} from "./attendance-session.handover.test.fixture.js";

describe("AttendanceSessionService - handover", () => {
  let fixture: AttendanceSessionHandoverFixture;

  const service = new AttendanceSessionService();

  beforeEach(async () => {
    fixture = await createAttendanceSessionHandoverFixture();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS "trg_test_fail_handover_insert"
      ON "AttendanceSessionSegment"
    `);

    await prisma.$executeRawUnsafe(`
      DROP FUNCTION IF EXISTS "test_fail_handover_insert"()
    `);

    await fixture.cleanup();
  });

  it("AS-008: handover menutup segment lama dan membuka segment baru dalam session yang sama", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const firstSegment = await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });

    const newSegment = await service.handover({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.substituteTeacherId,
      handoverAt: new Date("2026-09-25T07:40:00.000Z"),
    });

    expect(newSegment.attendanceSessionId).toBe(session.id);
    expect(newSegment.teacherId).toBe(fixture.substituteTeacherId);
    expect(newSegment.status).toBe("OPEN");
    expect(newSegment.startedAt).toEqual(
      new Date("2026-09-25T07:40:00.000Z"),
    );

    const segments = await prisma.attendanceSessionSegment.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
      orderBy: {
        startedAt: "asc",
      },
    });

    expect(segments).toHaveLength(2);

    expect(segments[0].id).toBe(firstSegment.id);
    expect(segments[0].teacherId).toBe(fixture.teacherId);
    expect(segments[0].status).toBe("CLOSED");
    expect(segments[0].endedAt).toEqual(
      new Date("2026-09-25T07:40:00.000Z"),
    );

    expect(segments[1].teacherId).toBe(fixture.substituteTeacherId);
    expect(segments[1].status).toBe("OPEN");
    expect(segments[1].endedAt).toBeNull();

    expect(
      segments.filter((segment) => segment.status === "OPEN"),
    ).toHaveLength(1);

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
  });

  it("AS-008-RB: handover rollback jika pembuatan segment baru gagal", async () => {
    const session = await service.createSession({
      institutionId: fixture.institutionId,
      scheduleId: fixture.scheduleId,
      sessionDate: fixture.sessionDate,
    });

    const firstSegment = await service.openSegment({
      institutionId: fixture.institutionId,
      sessionId: session.id,
      teacherId: fixture.teacherId,
      startedAt: new Date("2026-09-25T07:00:00.000Z"),
    });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "test_fail_handover_insert"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW."institutionId" = '${fixture.institutionId}'::uuid THEN
          RAISE EXCEPTION 'TEST_HANDOVER_INSERT_FAILURE';
        END IF;

        RETURN NEW;
      END;
      $$
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "trg_test_fail_handover_insert"
      BEFORE INSERT ON "AttendanceSessionSegment"
      FOR EACH ROW
      EXECUTE FUNCTION "test_fail_handover_insert"()
    `);

    await expect(
      service.handover({
        institutionId: fixture.institutionId,
        sessionId: session.id,
        teacherId: fixture.substituteTeacherId,
        handoverAt: new Date("2026-09-25T07:40:00.000Z"),
      }),
    ).rejects.toThrow("TEST_HANDOVER_INSERT_FAILURE");

    const segments = await prisma.attendanceSessionSegment.findMany({
      where: {
        institutionId: fixture.institutionId,
        attendanceSessionId: session.id,
      },
      orderBy: {
        startedAt: "asc",
      },
    });

    expect(segments).toHaveLength(1);

    expect(segments[0].id).toBe(firstSegment.id);
    expect(segments[0].teacherId).toBe(fixture.teacherId);

    /*
     * Jika transaction atomic:
     * UPDATE segment lama -> CLOSED
     * harus ikut rollback.
     */
    expect(segments[0].status).toBe("OPEN");
    expect(segments[0].endedAt).toBeNull();

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
  });
});
