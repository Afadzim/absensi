import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { MasterDataAuditContext } from "../master-data/master-data.service.js";
import {
  ScheduleInputError,
  parseScheduleInput,
  parseScheduleStudentParticipantInput,
  type ScheduleInput,
  type ScheduleStudentParticipantInput,
} from "./schedule.validation.js";

export class ScheduleNotFoundError extends Error {
  constructor(message = "Schedule not found.") {
    super(message);
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleConflictError";
  }
}

export type ScheduleAuditContext = MasterDataAuditContext;

export interface SchedulePage {
  page: number;
  pageSize: number;
}

export interface ScheduleFilters extends SchedulePage {
  academicYearId?: string;
  semesterId?: string;
  dayOfWeek?: number;
}

const scheduleInclude = {
  academicYear: { select: { id: true, code: true, name: true } },
  semester: { select: { id: true, code: true, name: true } },
  primaryTeacher: { select: { id: true, code: true, name: true } },
  class: { select: { id: true, code: true, name: true, level: true } },
  subject: { select: { id: true, code: true, name: true } },
  subjectOffering: { select: { id: true, offeringType: true } },
  room: { select: { id: true, code: true, name: true } },
  startPeriod: { select: { periodNumber: true, startTime: true, endTime: true } },
  endPeriod: { select: { periodNumber: true, startTime: true, endTime: true } },
  classParticipants: {
    include: { class: { select: { id: true, code: true, name: true, level: true } } },
    orderBy: { classId: "asc" as const },
  },
  studentParticipants: {
    include: { student: { select: { id: true, code: true, name: true } } },
    orderBy: [{ studentId: "asc" as const }, { effectiveFrom: "asc" as const }],
  },
} satisfies Prisma.ScheduleInclude;

type ScheduleView = Prisma.ScheduleGetPayload<{ include: typeof scheduleInclude }>;

type ScheduleValues = {
  academicYearId: string;
  semesterId: string;
  dayOfWeek: number;
  primaryTeacherId: string;
  classId: string;
  subjectId: string;
  subjectOfferingId: string | null;
  roomId: string | null;
  startPeriodNumber: number;
  endPeriodNumber: number;
};

function snapshot(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  context: ScheduleAuditContext,
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

async function lockInstitution(
  tx: Prisma.TransactionClient,
  institutionId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Institution"
    WHERE "id" = ${institutionId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new ScheduleNotFoundError("Institution not found.");
  }
}

function getScheduleValues(
  current: ScheduleValues | null,
  data: ScheduleInput,
): ScheduleValues {
  if (!current) {
    const required = [
      "academicYearId",
      "semesterId",
      "dayOfWeek",
      "primaryTeacherId",
      "classId",
      "subjectId",
      "startPeriodNumber",
      "endPeriodNumber",
    ] as const;
    for (const field of required) {
      if (data[field] === undefined) {
        throw new Error(`Validated schedule field ${field} is missing.`);
      }
    }
  }
  return {
    academicYearId: data.academicYearId ?? current!.academicYearId,
    semesterId: data.semesterId ?? current!.semesterId,
    dayOfWeek: data.dayOfWeek ?? current!.dayOfWeek,
    primaryTeacherId: data.primaryTeacherId ?? current!.primaryTeacherId,
    classId: data.classId ?? current!.classId,
    subjectId: data.subjectId ?? current!.subjectId,
    subjectOfferingId:
      data.subjectOfferingId === undefined
        ? current?.subjectOfferingId ?? null
        : data.subjectOfferingId,
    roomId:
      data.roomId === undefined ? current?.roomId ?? null : data.roomId,
    startPeriodNumber:
      data.startPeriodNumber ?? current!.startPeriodNumber,
    endPeriodNumber: data.endPeriodNumber ?? current!.endPeriodNumber,
  };
}

function scheduleClassIds(
  values: ScheduleValues,
  offeringType: "REGULAR" | "ELECTIVE" | undefined,
  configuredClassIds: string[],
): string[] {
  if (offeringType === "ELECTIVE") {
    return [values.classId];
  }
  return [...new Set([values.classId, ...configuredClassIds])];
}

export class ScheduleService {
  async list(
    institutionId: string,
    filters: ScheduleFilters,
  ): Promise<{ data: ScheduleView[]; total: number }> {
    const where: Prisma.ScheduleWhereInput = {
      institutionId,
      ...(filters.academicYearId
        ? { academicYearId: filters.academicYearId }
        : {}),
      ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
      ...(filters.dayOfWeek !== undefined
        ? { dayOfWeek: filters.dayOfWeek }
        : {}),
    };
    const skip = (filters.page - 1) * filters.pageSize;
    const [data, total] = await Promise.all([
      prisma.schedule.findMany({
        where,
        skip,
        take: filters.pageSize,
        include: scheduleInclude,
        orderBy: [
          { dayOfWeek: "asc" },
          { startPeriodNumber: "asc" },
          { id: "asc" },
        ],
      }),
      prisma.schedule.count({ where }),
    ]);
    return { data, total };
  }

  async get(institutionId: string, id: string): Promise<ScheduleView | null> {
    return prisma.schedule.findFirst({
      where: { id, institutionId },
      include: scheduleInclude,
    });
  }

  async create(
    context: ScheduleAuditContext,
    body: unknown,
  ): Promise<ScheduleView> {
    const { data, reason } = parseScheduleInput(body, "create");
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      await lockInstitution(tx, institutionId);
      const values = getScheduleValues(null, data);
      const classIds = [
        ...new Set([values.classId, ...(data.classParticipantIds ?? [])]),
      ];
      const offeringType = await this.validateReferences(
        tx,
        institutionId,
        values,
        classIds,
      );
      await this.assertNoConflicts(
        tx,
        institutionId,
        values,
        scheduleClassIds(values, offeringType, classIds),
      );

      const row = await tx.schedule.create({
        data: {
          institutionId,
          academicYearId: values.academicYearId,
          semesterId: values.semesterId,
          dayOfWeek: values.dayOfWeek,
          primaryTeacherId: values.primaryTeacherId,
          classId: values.classId,
          subjectId: values.subjectId,
          subjectOfferingId: values.subjectOfferingId,
          subjectOfferingInstitutionId: values.subjectOfferingId
            ? institutionId
            : null,
          roomId: values.roomId,
          roomInstitutionId: values.roomId ? institutionId : null,
          startPeriodNumber: values.startPeriodNumber,
          endPeriodNumber: values.endPeriodNumber,
        },
      });

      if (offeringType !== "ELECTIVE") {
        await tx.scheduleClassParticipant.createMany({
          data: classIds.map((classId) => ({
            institutionId,
            scheduleId: row.id,
            classId,
          })),
        });
      }

      const after = await tx.schedule.findFirstOrThrow({
        where: { id: row.id, institutionId },
        include: scheduleInclude,
      });
      await writeAudit(
        tx,
        context,
        "CREATE",
        "Schedule",
        row.id,
        null,
        after,
        reason,
      );
      return after;
    });
  }

  async update(
    context: ScheduleAuditContext,
    id: string,
    body: unknown,
  ): Promise<ScheduleView | null> {
    const { data, reason } = parseScheduleInput(body, "update");
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      await lockInstitution(tx, institutionId);
      const before = await tx.schedule.findFirst({
        where: { id, institutionId },
        include: scheduleInclude,
      });
      if (!before) return null;
      const values = getScheduleValues(before, data);
      const priorAdditionalClassIds = before.classParticipants
        .map(({ classId }) => classId)
        .filter((classId) => classId !== before.classId);
      const desiredAdditionalClassIds =
        data.classParticipantIds ?? priorAdditionalClassIds;
      const classIds = [
        ...new Set([
          values.classId,
          ...desiredAdditionalClassIds,
        ]),
      ];
      const offeringType = await this.validateReferences(
        tx,
        institutionId,
        values,
        classIds,
      );

      if (
        offeringType === "ELECTIVE" &&
        desiredAdditionalClassIds.length > 0
      ) {
        throw new ScheduleInputError(
          "A schedule with class participants cannot be changed to an ELECTIVE offering.",
        );
      }

      await this.assertNoConflicts(
        tx,
        institutionId,
        values,
        scheduleClassIds(values, offeringType, classIds),
        id,
      );

      const row = await tx.schedule.update({
        where: { id_institutionId: { id, institutionId } },
        data: {
          academicYearId: values.academicYearId,
          semesterId: values.semesterId,
          dayOfWeek: values.dayOfWeek,
          primaryTeacherId: values.primaryTeacherId,
          classId: values.classId,
          subjectId: values.subjectId,
          subjectOfferingId: values.subjectOfferingId,
          subjectOfferingInstitutionId: values.subjectOfferingId
            ? institutionId
            : null,
          roomId: values.roomId,
          roomInstitutionId: values.roomId ? institutionId : null,
          startPeriodNumber: values.startPeriodNumber,
          endPeriodNumber: values.endPeriodNumber,
        },
      });

      const desiredClassIds =
        offeringType === "ELECTIVE" ? [] : classIds;
      const desiredClassIdSet = new Set(desiredClassIds);
      const existingClassIds = new Set(
        before.classParticipants.map(({ classId }) => classId),
      );
      const newClassIds = desiredClassIds.filter(
        (classId) => !existingClassIds.has(classId),
      );
      const removedClassIds = [...existingClassIds].filter(
        (classId) => !desiredClassIdSet.has(classId),
      );
      if (newClassIds.length > 0) {
        await tx.scheduleClassParticipant.createMany({
          data: newClassIds.map((classId) => ({
            institutionId,
            scheduleId: row.id,
            classId,
          })),
        });
      }
      if (removedClassIds.length > 0) {
        await tx.scheduleClassParticipant.deleteMany({
          where: {
            institutionId,
            scheduleId: row.id,
            classId: { in: removedClassIds },
          },
        });
      }

      const after = await tx.schedule.findFirstOrThrow({
        where: { id, institutionId },
        include: scheduleInclude,
      });
      await writeAudit(
        tx,
        context,
        "UPDATE",
        "Schedule",
        id,
        before,
        after,
        reason,
      );
      return after;
    });
  }

  async createStudentParticipant(
    context: ScheduleAuditContext,
    scheduleId: string,
    body: unknown,
  ) {
    const { data, auditReason } = parseScheduleStudentParticipantInput(
      body,
      "create",
    );
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      await lockInstitution(tx, institutionId);
      const schedule = await tx.schedule.findFirst({
        where: { id: scheduleId, institutionId },
        select: { id: true },
      });
      if (!schedule) throw new ScheduleNotFoundError();
      const values = this.getParticipantValues(null, data);
      await this.validateStudentParticipant(
        tx,
        institutionId,
        scheduleId,
        values,
      );
      const row = await tx.scheduleStudentParticipant.create({
        data: {
          institutionId,
          scheduleId,
          studentId: values.studentId,
          action: values.action,
          effectiveFrom: values.effectiveFrom,
          effectiveTo: values.effectiveTo,
          reason: values.reason,
          createdByUserId: context.auth.userId,
        },
        include: { student: { select: { id: true, code: true, name: true } } },
      });
      await writeAudit(
        tx,
        context,
        "CREATE",
        "ScheduleStudentParticipant",
        row.id,
        null,
        row,
        auditReason,
      );
      return row;
    });
  }

  async updateStudentParticipant(
    context: ScheduleAuditContext,
    scheduleId: string,
    participantId: string,
    body: unknown,
  ) {
    const { data, auditReason } = parseScheduleStudentParticipantInput(
      body,
      "update",
    );
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      await lockInstitution(tx, institutionId);
      const before = await tx.scheduleStudentParticipant.findFirst({
        where: { id: participantId, scheduleId, institutionId },
        include: { student: { select: { id: true, code: true, name: true } } },
      });
      if (!before) return null;
      const values = this.getParticipantValues(before, data);
      await this.validateStudentParticipant(
        tx,
        institutionId,
        scheduleId,
        values,
        participantId,
      );
      const row = await tx.scheduleStudentParticipant.update({
        where: {
          id_institutionId: { id: participantId, institutionId },
        },
        data: {
          studentId: values.studentId,
          action: values.action,
          effectiveFrom: values.effectiveFrom,
          effectiveTo: values.effectiveTo,
          reason: values.reason,
        },
        include: { student: { select: { id: true, code: true, name: true } } },
      });
      await writeAudit(
        tx,
        context,
        "UPDATE",
        "ScheduleStudentParticipant",
        participantId,
        before,
        row,
        auditReason,
      );
      return row;
    });
  }

  private async validateReferences(
    tx: Prisma.TransactionClient,
    institutionId: string,
    values: ScheduleValues,
    classIds: string[],
  ): Promise<"REGULAR" | "ELECTIVE" | undefined> {
    const [academicYear, semester, teacher, subject, room, classes, offering] =
      await Promise.all([
        tx.academicYear.findFirst({
          where: { id: values.academicYearId, institutionId },
          select: { id: true },
        }),
        tx.semester.findFirst({
          where: {
            id: values.semesterId,
            institutionId,
            academicYearId: values.academicYearId,
          },
          select: { id: true },
        }),
        tx.teacher.findFirst({
          where: { id: values.primaryTeacherId, institutionId },
          select: { id: true },
        }),
        tx.subject.findFirst({
          where: { id: values.subjectId, institutionId },
          select: { id: true },
        }),
        values.roomId
          ? tx.room.findFirst({
              where: { id: values.roomId, institutionId },
              select: { id: true },
            })
          : Promise.resolve({ id: null }),
        tx.class.findMany({
          where: { id: { in: classIds }, institutionId },
          select: { id: true },
        }),
        values.subjectOfferingId
          ? tx.subjectOffering.findFirst({
              where: {
                id: values.subjectOfferingId,
                institutionId,
                academicYearId: values.academicYearId,
                subjectId: values.subjectId,
              },
              select: { id: true, offeringType: true },
            })
          : Promise.resolve(null),
      ]);

    if (!academicYear || !semester || !teacher || !subject || !room) {
      throw new ScheduleNotFoundError(
        "One or more referenced schedule records are missing or outside this institution.",
      );
    }
    if (classes.length !== classIds.length) {
      throw new ScheduleNotFoundError(
        "One or more participant classes are missing or outside this institution.",
      );
    }
    if (values.subjectOfferingId && !offering) {
      throw new ScheduleNotFoundError(
        "Subject offering is missing or does not match the schedule year and subject.",
      );
    }

    const periods = await tx.schedulePeriod.findMany({
      where: {
        institutionId,
        periodNumber: {
          gte: values.startPeriodNumber,
          lte: values.endPeriodNumber,
        },
      },
      select: { periodNumber: true },
    });
    const expectedCount =
      values.endPeriodNumber - values.startPeriodNumber + 1;
    if (periods.length !== expectedCount) {
      throw new ScheduleInputError(
        "Every schedule period in the inclusive start/end range must exist.",
      );
    }

    if (
      offering?.offeringType === "ELECTIVE" &&
      classIds.some((classId) => classId !== values.classId)
    ) {
      throw new ScheduleInputError(
        "ELECTIVE schedules use the subject offering roster and cannot have additional class participants.",
      );
    }
    return offering?.offeringType;
  }

  private async assertNoConflicts(
    tx: Prisma.TransactionClient,
    institutionId: string,
    values: ScheduleValues,
    classIds: string[],
    excludeId?: string,
  ): Promise<void> {
    const candidates = await tx.schedule.findMany({
      where: {
        institutionId,
        academicYearId: values.academicYearId,
        semesterId: values.semesterId,
        dayOfWeek: values.dayOfWeek,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startPeriodNumber: { lte: values.endPeriodNumber },
        endPeriodNumber: { gte: values.startPeriodNumber },
      },
      include: {
        subjectOffering: { select: { offeringType: true } },
        classParticipants: { select: { classId: true } },
      },
    });

    for (const candidate of candidates) {
      if (candidate.primaryTeacherId === values.primaryTeacherId) {
        throw new ScheduleConflictError(
          "The primary teacher already has a schedule during an overlapping period.",
        );
      }
      if (values.roomId && candidate.roomId === values.roomId) {
        throw new ScheduleConflictError(
          "The room is already assigned during an overlapping period.",
        );
      }
      const candidateClassIds =
        candidate.subjectOffering?.offeringType === "ELECTIVE"
          ? [candidate.classId]
          : [
              ...new Set([
                candidate.classId,
                ...candidate.classParticipants.map(({ classId }) => classId),
              ]),
            ];
      if (candidateClassIds.some((classId) => classIds.includes(classId))) {
        throw new ScheduleConflictError(
          "A participant class already has a schedule during an overlapping period.",
        );
      }
    }
  }

  private getParticipantValues(
    current: {
      studentId: string;
      action: "INCLUDE" | "EXCLUDE";
      effectiveFrom: Date;
      effectiveTo: Date | null;
      reason: string | null;
    } | null,
    data: ScheduleStudentParticipantInput,
  ) {
    if (!current) {
      if (
        !data.studentId ||
        !data.action ||
        !data.effectiveFrom
      ) {
        throw new Error("Validated participant fields are missing.");
      }
    }
    const values = {
      studentId: data.studentId ?? current!.studentId,
      action: data.action ?? current!.action,
      effectiveFrom: data.effectiveFrom ?? current!.effectiveFrom,
      effectiveTo:
        data.effectiveTo === undefined
          ? current?.effectiveTo ?? null
          : data.effectiveTo,
      reason:
        data.reason === undefined ? current?.reason ?? null : data.reason,
    };
    if (values.effectiveTo && values.effectiveTo < values.effectiveFrom) {
      throw new ScheduleInputError(
        "effectiveTo must be on or after effectiveFrom.",
      );
    }
    return values;
  }

  private async validateStudentParticipant(
    tx: Prisma.TransactionClient,
    institutionId: string,
    scheduleId: string,
    values: ReturnType<ScheduleService["getParticipantValues"]>,
    excludeId?: string,
  ): Promise<void> {
    const student = await tx.student.findFirst({
      where: { id: values.studentId, institutionId },
      select: { id: true },
    });
    if (!student) {
      throw new ScheduleNotFoundError(
        "Student is missing or outside this institution.",
      );
    }
    const overlapping = await tx.scheduleStudentParticipant.findFirst({
      where: {
        institutionId,
        scheduleId,
        studentId: values.studentId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...(values.effectiveTo
          ? { effectiveFrom: { lte: values.effectiveTo } }
          : {}),
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: values.effectiveFrom } },
        ],
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new ScheduleConflictError(
        "The student already has an overlapping participant override for this schedule.",
      );
    }
  }
}
