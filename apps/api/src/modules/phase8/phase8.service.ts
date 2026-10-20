import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthContext } from "../auth/auth.context.js";
import type { AcademicCalendarDayType, ReportRange } from "./phase8.validation.js";
import {
  institutionalToday,
  systemEffectiveDate,
} from "./phase8.validation.js";

export interface Phase8AuditContext {
  auth: AuthContext;
  requestId: string;
  ipAddress: string;
  userAgent?: string;
}

export class Phase8NotFoundError extends Error {
  constructor(message = "Academic calendar day not found.") {
    super(message);
    this.name = "Phase8NotFoundError";
  }
}

export class Phase8ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase8ConflictError";
  }
}

function snapshot(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayOfWeek(value: Date): number {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

function calendarDayCount(startDate: Date, endDate: Date): number {
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

function timeOfDayMilliseconds(value: Date): number {
  return (
    value.getUTCHours() * 3_600_000 +
    value.getUTCMinutes() * 60_000 +
    value.getUTCSeconds() * 1_000
  );
}

function institutionalClock(now: Date): { date: string; time: string } {
  const timeZone = process.env.ATTENDANCE_TIME_ZONE?.trim() || "Asia/Jakarta";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error(`Could not format time in ${timeZone}.`);
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function occurrenceHasEnded(
  date: Date,
  endTime: Date,
  now: Date,
): boolean {
  const occurrenceDate = dateKey(date);
  const current = institutionalClock(now);
  if (occurrenceDate < current.date) return true;
  if (occurrenceDate > current.date) return false;
  const hour = String(endTime.getUTCHours()).padStart(2, "0");
  const minute = String(endTime.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}` <= current.time;
}

function countAttendance(
  counts: Record<string, number>,
  status: string,
): void {
  counts[status] = (counts[status] ?? 0) + 1;
}

export function attendancePercentage(
  counts: Record<string, number>,
  denominator: number,
): number | null {
  if (denominator === 0) return null;
  return Math.round(
    (((counts.HADIR ?? 0) + (counts.PENUGASAN ?? 0)) / denominator) *
      10_000,
  ) / 100;
}

export function teacherPercentage(
  counts: Record<string, number>,
  denominator: number,
): number | null {
  if (denominator === 0) return null;
  return Math.round(
    (((counts.HADIR ?? 0) + (counts.DINAS ?? 0)) / denominator) * 10_000,
  ) / 100;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  context: Phase8AuditContext,
  action: "CREATE" | "UPDATE",
  entity: string,
  entityId: string,
  before: object | null,
  after: object,
  reason?: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      institutionId: context.auth.institutionId,
      actorUserId: context.auth.userId,
      actorInstitutionId: context.auth.institutionId,
      action,
      entity,
      entityId,
      beforeData: before ? snapshot(before) : Prisma.JsonNull,
      afterData: snapshot(after),
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      reason,
    },
  });
}

export class Phase8Service {
  async listCalendarDays(
    institutionId: string,
    startDate: Date,
    endDate: Date,
  ) {
    return prisma.academicCalendarDay.findMany({
      where: {
        institutionId,
        calendarDate: { gte: startDate, lte: endDate },
      },
      include: { _count: { select: { occurrences: true } } },
      orderBy: [{ calendarDate: "asc" }, { id: "asc" }],
    });
  }

  async createCalendarDay(
    context: Phase8AuditContext,
    input: {
      calendarDate: Date;
      dayType: AcademicCalendarDayType;
      label?: string | null;
      reason?: string;
    },
  ) {
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      const row = await tx.academicCalendarDay.create({
        data: {
          institutionId,
          calendarDate: input.calendarDate,
          dayType: input.dayType,
          label: input.label,
          createdById: context.auth.userId,
        },
      });
      await writeAudit(
        tx,
        context,
        "CREATE",
        "AcademicCalendarDay",
        row.id,
        null,
        row,
        input.reason,
      );
      return row;
    });
  }

  async updateCalendarDay(
    context: Phase8AuditContext,
    id: string,
    input: {
      dayType?: AcademicCalendarDayType;
      label?: string | null;
      reason?: string;
    },
  ) {
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AcademicCalendarDay"
        WHERE "id" = ${id}::uuid
          AND "institutionId" = ${institutionId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) throw new Phase8NotFoundError();
      const before = await tx.academicCalendarDay.findFirst({
        where: { id, institutionId },
      });
      if (!before) throw new Phase8NotFoundError();
      if (before.generationCompletedAt) {
        throw new Phase8ConflictError(
          "A calendar day cannot be changed after schedule occurrences have been generated.",
        );
      }
      const row = await tx.academicCalendarDay.update({
        where: { id_institutionId: { id, institutionId } },
        data: {
          ...(input.dayType !== undefined ? { dayType: input.dayType } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
        },
      });
      await writeAudit(
        tx,
        context,
        "UPDATE",
        "AcademicCalendarDay",
        row.id,
        before,
        row,
        input.reason,
      );
      return row;
    });
  }

  async generateOccurrences(
    institutionId: string,
    now = new Date(),
  ): Promise<{ calendarDays: number; occurrences: number }> {
    const startDate = new Date(
      Math.max(
        institutionalToday(now).getTime(),
        systemEffectiveDate().getTime(),
      ),
    );
    const days = await prisma.academicCalendarDay.findMany({
      where: {
        institutionId,
        calendarDate: { gte: startDate },
        generationCompletedAt: null,
      },
      select: { id: true, calendarDate: true },
      orderBy: { calendarDate: "asc" },
    });
    let generatedDays = 0;
    let generatedOccurrences = 0;

    for (const day of days) {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "AcademicCalendarDay"
          WHERE "id" = ${day.id}::uuid
            AND "institutionId" = ${institutionId}::uuid
          FOR UPDATE
        `;
        if (locked.length === 0) throw new Phase8NotFoundError();
        const calendarDay = await tx.academicCalendarDay.findUniqueOrThrow({
          where: { id_institutionId: { id: day.id, institutionId } },
        });
        if (calendarDay.generationCompletedAt) {
          return { generated: false, count: 0 };
        }

        const schedules =
          calendarDay.dayType === "EFFECTIVE"
            ? await tx.schedule.findMany({
                where: {
                  institutionId,
                  dayOfWeek: dayOfWeek(calendarDay.calendarDate),
                },
                include: {
                  primaryTeacher: { select: { id: true, code: true, name: true } },
                  class: { select: { id: true, code: true, name: true } },
                  subject: { select: { id: true, code: true, name: true } },
                  startPeriod: { select: { startTime: true } },
                  endPeriod: { select: { endTime: true } },
                },
                orderBy: [{ startPeriodNumber: "asc" }, { id: "asc" }],
              })
            : [];

        const result = await tx.scheduleOccurrence.createMany({
          data: schedules.map((schedule) => ({
            institutionId,
            academicCalendarDayId: calendarDay.id,
            scheduleId: schedule.id,
            occurrenceDate: calendarDay.calendarDate,
            status: "EFFECTIVE" as const,
            primaryTeacherIdSnapshot: schedule.primaryTeacher.id,
            primaryTeacherCodeSnapshot: schedule.primaryTeacher.code,
            primaryTeacherNameSnapshot: schedule.primaryTeacher.name,
            classIdSnapshot: schedule.class.id,
            classCodeSnapshot: schedule.class.code,
            classNameSnapshot: schedule.class.name,
            subjectIdSnapshot: schedule.subject.id,
            subjectCodeSnapshot: schedule.subject.code,
            subjectNameSnapshot: schedule.subject.name,
            startPeriodNumberSnapshot: schedule.startPeriodNumber,
            endPeriodNumberSnapshot: schedule.endPeriodNumber,
            startTimeSnapshot: schedule.startPeriod.startTime,
            endTimeSnapshot: schedule.endPeriod.endTime,
            scheduledJpSnapshot:
              schedule.endPeriodNumber - schedule.startPeriodNumber + 1,
          })),
          skipDuplicates: true,
        });
        const generatedAt = new Date();
        await tx.academicCalendarDay.update({
          where: { id_institutionId: { id: day.id, institutionId } },
          data: { generationCompletedAt: generatedAt },
        });
        await tx.auditLog.create({
          data: {
            institutionId,
            action: "GENERATE",
            entity: "AcademicCalendarDay",
            entityId: calendarDay.id,
            beforeData: Prisma.JsonNull,
            afterData: snapshot({
              calendarDate: calendarDay.calendarDate,
              dayType: calendarDay.dayType,
              generatedOccurrenceCount: result.count,
              generationCompletedAt: generatedAt,
            }),
            requestId: "schedule-occurrence-generator",
            reason: "immutable-schedule-occurrence-generation",
          },
        });
        return { generated: true, count: result.count };
      });
      if (result.generated) {
        generatedDays += 1;
        generatedOccurrences += result.count;
      }
    }

    return { calendarDays: generatedDays, occurrences: generatedOccurrences };
  }

  async buildReport(
    institutionId: string,
    range: ReportRange,
    now = new Date(),
  ) {
    const calendarDays = await prisma.academicCalendarDay.findMany({
      where: {
        institutionId,
        calendarDate: { gte: range.startDate, lte: range.endDate },
      },
      select: {
        calendarDate: true,
        dayType: true,
        generationCompletedAt: true,
      },
      orderBy: { calendarDate: "asc" },
    });
    const expectedDates = calendarDayCount(range.startDate, range.endDate);
    if (calendarDays.length !== expectedDates) {
      const configured = new Set(calendarDays.map(({ calendarDate }) => dateKey(calendarDate)));
      const missing = new Date(range.startDate);
      while (missing <= range.endDate && configured.has(dateKey(missing))) {
        missing.setUTCDate(missing.getUTCDate() + 1);
      }
      throw new Phase8ConflictError(
        `Academic calendar is incomplete for ${dateKey(missing)}; configure every date in the report range.`,
      );
    }
    const ungeneratedDay = calendarDays.find((day) => !day.generationCompletedAt);
    if (ungeneratedDay) {
      throw new Phase8ConflictError(
        `Schedule occurrences have not been generated for ${dateKey(ungeneratedDay.calendarDate)}.`,
      );
    }

    const occurrences = await prisma.scheduleOccurrence.findMany({
      where: {
        institutionId,
        occurrenceDate: { gte: range.startDate, lte: range.endDate },
        status: "EFFECTIVE",
      },
      orderBy: [
        { occurrenceDate: "asc" },
        { startPeriodNumberSnapshot: "asc" },
        { id: "asc" },
      ],
    });
    const scheduleIds = [...new Set(occurrences.map((item) => item.scheduleId))];
    const teacherIds = [
      ...new Set(occurrences.map((item) => item.primaryTeacherIdSnapshot)),
    ];
    const sessions = scheduleIds.length
      ? await prisma.attendanceSession.findMany({
          where: {
            institutionId,
            scheduleId: { in: scheduleIds },
            sessionDate: { gte: range.startDate, lte: range.endDate },
          },
          include: {
            teacherAttendances: true,
            studentAttendances: true,
          },
        })
      : [];
    const sessionByOccurrence = new Map(
      sessions.map((session) => [
        `${session.scheduleId}:${dateKey(session.sessionDate)}`,
        session,
      ]),
    );
    const teacherStatuses = teacherIds.length
      ? await prisma.teacherAdministrativeStatus.findMany({
          where: {
            institutionId,
            teacherId: { in: teacherIds },
            validFrom: { lte: range.endDate },
            OR: [
              { validTo: null },
              { validTo: { gte: range.startDate } },
            ],
          },
        })
      : [];
    const substitutions = scheduleIds.length
      ? await prisma.teacherSubstitution.findMany({
          where: {
            institutionId,
            scheduleId: { in: scheduleIds },
            substitutionDate: { gte: range.startDate, lte: range.endDate },
            status: "APPROVED",
          },
          include: {
            substituteTeacher: { select: { code: true, name: true } },
          },
        })
      : [];

    const studentByClass = new Map<
      string,
      {
        classId: string;
        classCode: string;
        className: string;
        counts: Record<string, number>;
        denominator: number;
      }
    >();
    const studentBySubject = new Map<
      string,
      {
        subjectId: string;
        subjectCode: string;
        subjectName: string;
        counts: Record<string, number>;
        denominator: number;
      }
    >();
    const teacherByPrimary = new Map<
      string,
      {
        teacherId: string;
        teacherCode: string;
        teacherName: string;
        counts: Record<string, number>;
        denominator: number;
      }
    >();
    const substituteSummary = new Map<
      string,
      {
        teacherId: string;
        teacherCode: string;
        teacherName: string;
        counts: Record<string, number>;
      }
    >();

    let elapsedOccurrences = 0;
    let finalizedOccurrences = 0;
    let openOccurrences = 0;
    let cancelledOccurrences = 0;
    let missedOccurrences = 0;
    let upcomingOccurrences = 0;

    for (const occurrence of occurrences) {
      const occurrenceKey = `${occurrence.scheduleId}:${dateKey(occurrence.occurrenceDate)}`;
      const session = sessionByOccurrence.get(occurrenceKey);
      const elapsed = occurrenceHasEnded(
        occurrence.occurrenceDate,
        occurrence.endTimeSnapshot,
        now,
      );
      if (!elapsed) {
        upcomingOccurrences += 1;
        continue;
      }
      elapsedOccurrences += 1;
      if (session?.status === "FINALIZED") finalizedOccurrences += 1;
      else if (session?.status === "OPEN") openOccurrences += 1;
      else if (session?.status === "CANCELLED") cancelledOccurrences += 1;
      else missedOccurrences += 1;

      const primary = teacherByPrimary.get(occurrence.primaryTeacherIdSnapshot) ?? {
        teacherId: occurrence.primaryTeacherIdSnapshot,
        teacherCode: occurrence.primaryTeacherCodeSnapshot,
        teacherName: occurrence.primaryTeacherNameSnapshot,
        counts: {},
        denominator: 0,
      };
      primary.denominator += 1;
      const primaryAttendance = session?.teacherAttendances.find(
        (row) => row.teacherId === occurrence.primaryTeacherIdSnapshot,
      );
      const activeTeacherStatuses = teacherStatuses.filter(
        (status) =>
          status.teacherId === occurrence.primaryTeacherIdSnapshot &&
          status.validFrom <= occurrence.occurrenceDate &&
          (!status.validTo || status.validTo >= occurrence.occurrenceDate),
      );
      if (activeTeacherStatuses.length > 1) {
        throw new Phase8ConflictError(
          `Multiple active administrative statuses exist for teacher ${occurrence.primaryTeacherCodeSnapshot} on ${dateKey(occurrence.occurrenceDate)}.`,
        );
      }
      const primaryStatus =
        activeTeacherStatuses[0]?.type ??
        primaryAttendance?.status ??
        "ALPA";
      countAttendance(primary.counts, primaryStatus);
      teacherByPrimary.set(primary.teacherId, primary);

      const occurrenceSubstitutions = substitutions.filter(
        (substitution) =>
          substitution.scheduleId === occurrence.scheduleId &&
          dateKey(substitution.substitutionDate) === dateKey(occurrence.occurrenceDate) &&
          timeOfDayMilliseconds(substitution.startTime) <
            timeOfDayMilliseconds(occurrence.endTimeSnapshot) &&
          timeOfDayMilliseconds(substitution.endTime) >
            timeOfDayMilliseconds(occurrence.startTimeSnapshot),
      );
      for (const substitution of occurrenceSubstitutions) {
        const substitute = substituteSummary.get(substitution.substituteTeacherId) ?? {
          teacherId: substitution.substituteTeacherId,
          teacherCode: substitution.substituteTeacher.code,
          teacherName: substitution.substituteTeacher.name,
          counts: {},
        };
        const substituteAttendance = session?.teacherAttendances.find(
          (row) => row.teacherId === substitution.substituteTeacherId,
        );
        countAttendance(
          substitute.counts,
          substituteAttendance?.status ?? "ALPA",
        );
        substituteSummary.set(substitution.substituteTeacherId, substitute);
      }

      if (session?.status !== "FINALIZED") continue;
      for (const attendance of session.studentAttendances) {
        const classRow = studentByClass.get(attendance.classIdSnapshot) ?? {
          classId: attendance.classIdSnapshot,
          classCode: attendance.classCodeSnapshot,
          className: attendance.classNameSnapshot,
          counts: {},
          denominator: 0,
        };
        classRow.denominator += 1;
        countAttendance(classRow.counts, attendance.status);
        studentByClass.set(classRow.classId, classRow);

        const subjectRow = studentBySubject.get(session.subjectIdSnapshot) ?? {
          subjectId: session.subjectIdSnapshot,
          subjectCode: session.subjectCodeSnapshot,
          subjectName: session.subjectNameSnapshot,
          counts: {},
          denominator: 0,
        };
        subjectRow.denominator += 1;
        countAttendance(subjectRow.counts, attendance.status);
        studentBySubject.set(subjectRow.subjectId, subjectRow);
      }
    }

    const toStudentRows = <T extends {
      counts: Record<string, number>;
      denominator: number;
    }>(rows: Map<string, T>) =>
      [...rows.values()]
        .map((row) => ({
          ...row,
          percentage: attendancePercentage(row.counts, row.denominator),
        }))
        .sort((left, right) =>
          String((left as { className?: string; subjectName?: string }).className ??
            (left as { subjectName?: string }).subjectName)
            .localeCompare(
              String((right as { className?: string; subjectName?: string }).className ??
                (right as { subjectName?: string }).subjectName),
              "id",
            ),
        );

    return {
      period: {
        startDate: dateKey(range.startDate),
        endDate: dateKey(range.endDate),
        systemEffectiveDate: dateKey(systemEffectiveDate()),
        attendanceTimeZone:
          process.env.ATTENDANCE_TIME_ZONE?.trim() || "Asia/Jakarta",
        backfilled: false,
      },
      calendar: {
        configuredDays: calendarDays.length,
        effectiveDays: calendarDays.filter((day) => day.dayType === "EFFECTIVE").length,
        holidays: calendarDays.filter((day) => day.dayType !== "EFFECTIVE").length,
      },
      instruction: {
        effectiveOccurrences: occurrences.length,
        elapsedOccurrences,
        upcomingOccurrences,
        finalizedOccurrences,
        openOccurrences,
        cancelledOccurrences,
        missedOccurrences,
      },
      studentByClass: toStudentRows(studentByClass),
      studentBySubject: toStudentRows(studentBySubject),
      teacherByPrimary: [...teacherByPrimary.values()]
        .map((row) => ({
          ...row,
          percentage: teacherPercentage(row.counts, row.denominator),
        }))
        .sort((left, right) => left.teacherName.localeCompare(right.teacherName, "id")),
      substituteSummary: [...substituteSummary.values()]
        .sort((left, right) => left.teacherName.localeCompare(right.teacherName, "id")),
    };
  }
}
