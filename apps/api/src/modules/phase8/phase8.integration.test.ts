import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, testPrisma } from "../../test/db.js";
import {
  Phase8ConflictError,
  Phase8Service,
} from "./phase8.service.js";

const EFFECTIVE_DATE = "2026-07-15";

function suffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createFixture() {
  const key = suffix();
  const institution = await testPrisma.institution.create({
    data: { code: `P8-${key}`, name: `Phase 8 ${key}` },
  });
  const actor = await testPrisma.user.create({
    data: {
      institutionId: institution.id,
      username: `phase8-${key}`,
      passwordHash: "test-password-hash",
    },
  });
  const academicYear = await testPrisma.academicYear.create({
    data: {
      institutionId: institution.id,
      code: `P8-AY-${key}`,
      name: "Phase 8 year",
    },
  });
  const semester = await testPrisma.semester.create({
    data: {
      institutionId: institution.id,
      academicYearId: academicYear.id,
      code: `P8-S-${key}`,
      name: "Phase 8 semester",
    },
  });
  const teacher = await testPrisma.teacher.create({
    data: {
      institutionId: institution.id,
      code: `P8-T-${key}`,
      name: "Phase 8 Teacher",
    },
  });
  const classRecord = await testPrisma.class.create({
    data: {
      institutionId: institution.id,
      code: `P8-C-${key}`,
      name: "Phase 8 Class",
    },
  });
  const subject = await testPrisma.subject.create({
    data: {
      institutionId: institution.id,
      code: `P8-SUB-${key}`,
      name: "Phase 8 Subject",
    },
  });
  await testPrisma.schedulePeriod.createMany({
    data: [
      { periodNumber: 1, startTime: "1970-01-01T08:00:00.000Z", endTime: "1970-01-01T08:30:00.000Z" },
      { periodNumber: 2, startTime: "1970-01-01T08:30:00.000Z", endTime: "1970-01-01T09:00:00.000Z" },
    ].map((period) => ({
      institutionId: institution.id,
      periodNumber: period.periodNumber,
      startTime: new Date(period.startTime),
      endTime: new Date(period.endTime),
    })),
  });
  const schedule = await testPrisma.schedule.create({
    data: {
      institutionId: institution.id,
      academicYearId: academicYear.id,
      semesterId: semester.id,
      dayOfWeek: 3,
      primaryTeacherId: teacher.id,
      classId: classRecord.id,
      subjectId: subject.id,
      startPeriodNumber: 1,
      endPeriodNumber: 2,
    },
  });
  const service = new Phase8Service();
  const context = {
    auth: {
      sessionId: `phase8-${key}`,
      userId: actor.id,
      institutionId: institution.id,
      teacherId: null,
      roles: [],
      permissions: [],
    },
    requestId: `phase8-${key}`,
    ipAddress: "127.0.0.1",
    userAgent: "vitest-phase8",
  };
  return { institution, schedule, service, context, teacher };
}

describe("Phase8Service", () => {
  beforeAll(() => {
    process.env.SYSTEM_EFFECTIVE_DATE = EFFECTIVE_DATE;
    process.env.ATTENDANCE_TIME_ZONE = "Asia/Jakarta";
  });

  afterAll(async () => {
    delete process.env.SYSTEM_EFFECTIVE_DATE;
    await closeTestDb();
  });

  it("generates immutable tenant-scoped occurrences idempotently and derives elapsed teacher ALPA", async () => {
    const fixture = await createFixture();
    const effectiveDate = new Date(`${EFFECTIVE_DATE}T00:00:00.000Z`);
    const holidayDate = new Date("2026-07-16T00:00:00.000Z");
    const effectiveDay = await fixture.service.createCalendarDay(
      fixture.context,
      {
        calendarDate: effectiveDate,
        dayType: "EFFECTIVE",
        label: "Hari efektif",
      },
    );
    await fixture.service.createCalendarDay(fixture.context, {
      calendarDate: holidayDate,
      dayType: "NATIONAL_HOLIDAY",
      label: "Libur nasional",
    });

    const generationTime = new Date("2026-07-14T12:00:00.000Z");
    await expect(
      fixture.service.listCalendarDays(
        `00000000-0000-4000-8000-000000000000`,
        effectiveDate,
        holidayDate,
      ),
    ).resolves.toEqual([]);
    await expect(
      fixture.service.generateOccurrences(fixture.institution.id, generationTime),
    ).resolves.toEqual({ calendarDays: 2, occurrences: 1 });
    await expect(
      fixture.service.generateOccurrences(fixture.institution.id, generationTime),
    ).resolves.toEqual({ calendarDays: 0, occurrences: 0 });

    const occurrence = await testPrisma.scheduleOccurrence.findFirstOrThrow({
      where: { institutionId: fixture.institution.id },
    });
    expect(occurrence).toMatchObject({
      scheduleId: fixture.schedule.id,
      occurrenceDate: effectiveDate,
      primaryTeacherIdSnapshot: fixture.teacher.id,
    });

    await expect(
      fixture.service.updateCalendarDay(fixture.context, effectiveDay.id, {
        dayType: "SPECIAL_HOLIDAY",
      }),
    ).rejects.toBeInstanceOf(Phase8ConflictError);

    const report = await fixture.service.buildReport(
      fixture.institution.id,
      { startDate: effectiveDate, endDate: effectiveDate },
      new Date("2026-07-15T02:00:00.000Z"),
    );
    expect(report.instruction).toMatchObject({
      effectiveOccurrences: 1,
      elapsedOccurrences: 1,
      missedOccurrences: 1,
    });
    expect(report.teacherByPrimary[0]).toMatchObject({
      teacherId: fixture.teacher.id,
      denominator: 1,
      counts: { ALPA: 1 },
      percentage: 0,
    });
    expect(report.studentByClass).toEqual([]);
  });

  it("rejects official reporting when any calendar date is missing or unprocessed", async () => {
    const fixture = await createFixture();
    const startDate = new Date(`${EFFECTIVE_DATE}T00:00:00.000Z`);
    await expect(
      fixture.service.buildReport(fixture.institution.id, {
        startDate,
        endDate: startDate,
      }),
    ).rejects.toThrow(/calendar is incomplete/u);

    await fixture.service.createCalendarDay(fixture.context, {
      calendarDate: startDate,
      dayType: "EFFECTIVE",
    });
    await expect(
      fixture.service.buildReport(fixture.institution.id, {
        startDate,
        endDate: startDate,
      }),
    ).rejects.toThrow(/not been generated/u);
  });
});
