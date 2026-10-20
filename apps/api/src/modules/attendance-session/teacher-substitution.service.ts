import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthContext } from "../auth/auth.context.js";

type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

export interface TeacherSubstitutionAuditContext {
  auth: AuthContext;
  requestId: string;
  ipAddress: string;
  userAgent?: string;
}

export interface CreateTeacherSubstitutionInput {
  substitutionDate: Date;
  substituteTeacherId: string;
  startTime: Date;
  endTime: Date;
  reason: string;
}

export interface TeacherSubstitutionFilters {
  page: number;
  pageSize: number;
  substitutionDate?: Date;
}

export class TeacherSubstitutionNotFoundError extends Error {
  constructor(message = "Teacher substitution or schedule not found.") {
    super(message);
    this.name = "TeacherSubstitutionNotFoundError";
  }
}

export class TeacherSubstitutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeacherSubstitutionConflictError";
  }
}

export class TeacherSubstitutionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeacherSubstitutionInputError";
  }
}

function snapshot(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  context: TeacherSubstitutionAuditContext,
  action: "CREATE" | "UPDATE",
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
      entity: "TeacherSubstitution",
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

function timeMilliseconds(value: Date): number {
  return (
    value.getUTCHours() * 60 * 60 * 1000 +
    value.getUTCMinutes() * 60 * 1000 +
    value.getUTCSeconds() * 1000
  );
}

function weekday(value: Date): number {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

async function lockSchedule(
  tx: Prisma.TransactionClient,
  institutionId: string,
  scheduleId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Schedule"
    WHERE "id" = ${scheduleId}::uuid
      AND "institutionId" = ${institutionId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new TeacherSubstitutionNotFoundError("Schedule not found.");
  }
}

async function lockAttendanceSession(
  tx: Prisma.TransactionClient,
  institutionId: string,
  sessionId: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "AttendanceSession"
    WHERE "id" = ${sessionId}::uuid
      AND "institutionId" = ${institutionId}::uuid
    FOR UPDATE
  `;
}

async function withSubstitutionTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(operation);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2004" || error.code === "P2039")
    ) {
      throw new TeacherSubstitutionConflictError(
        "The substitution violates a database integrity constraint, including active interval overlap.",
      );
    }
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23P01"
    ) {
      throw new TeacherSubstitutionConflictError(
        "Active substitution intervals must not overlap.",
      );
    }
    throw error;
  }
}

async function scheduleDetails(
  tx: Prisma.TransactionClient,
  institutionId: string,
  scheduleId: string,
  substitutionDate: Date,
) {
  const schedule = await tx.schedule.findFirst({
    where: { id: scheduleId, institutionId },
    include: {
      startPeriod: { select: { startTime: true } },
      endPeriod: { select: { endTime: true } },
    },
  });
  if (!schedule) {
    throw new TeacherSubstitutionNotFoundError("Schedule not found.");
  }
  const session = await tx.attendanceSession.findUnique({
    where: {
      scheduleId_sessionDate: {
        scheduleId,
        sessionDate: substitutionDate,
      },
    },
  });
  if (!session && schedule.dayOfWeek !== weekday(substitutionDate)) {
    throw new TeacherSubstitutionInputError(
      "substitutionDate does not match the schedule weekday.",
    );
  }
  const scheduleStart =
    session?.startTimeSnapshot ?? schedule.startPeriod.startTime;
  const scheduleEnd =
    session?.endTimeSnapshot ?? schedule.endPeriod.endTime;
  return {
    schedule,
    session,
    primaryTeacherId:
      session?.primaryTeacherIdSnapshot ?? schedule.primaryTeacherId,
    startTime: scheduleStart,
    endTime: scheduleEnd,
  };
}

function assertSubstitutionRange(
  input: Pick<
    CreateTeacherSubstitutionInput,
    "startTime" | "endTime" | "substituteTeacherId"
  >,
  primaryTeacherId: string,
  scheduledStart: Date,
  scheduledEnd: Date,
): void {
  const start = timeMilliseconds(input.startTime);
  const end = timeMilliseconds(input.endTime);
  if (end <= start) {
    throw new TeacherSubstitutionInputError(
      "endTime must be after startTime.",
    );
  }
  if (
    start < timeMilliseconds(scheduledStart) ||
    end > timeMilliseconds(scheduledEnd)
  ) {
    throw new TeacherSubstitutionInputError(
      "Substitution time range must be within the scheduled learning-unit time.",
    );
  }
  if (input.substituteTeacherId === primaryTeacherId) {
    throw new TeacherSubstitutionInputError(
      "Substitute teacher must differ from the primary teacher.",
    );
  }
}

export class TeacherSubstitutionService {
  async list(
    institutionId: string,
    scheduleId: string,
    filters: TeacherSubstitutionFilters,
  ) {
    const schedule = await prisma.schedule.findFirst({
      where: { id: scheduleId, institutionId },
      select: { id: true },
    });
    if (!schedule) {
      throw new TeacherSubstitutionNotFoundError("Schedule not found.");
    }
    const where = {
      institutionId,
      scheduleId,
      ...(filters.substitutionDate
        ? { substitutionDate: filters.substitutionDate }
        : {}),
    };
    const [data, total] = await Promise.all([
      prisma.teacherSubstitution.findMany({
        where,
        include: {
          originalTeacher: { select: { id: true, code: true, name: true } },
          substituteTeacher: { select: { id: true, code: true, name: true } },
        },
        orderBy: [
          { substitutionDate: "desc" },
          { startTime: "asc" },
          { id: "asc" },
        ],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.teacherSubstitution.count({ where }),
    ]);
    return { data, total };
  }

  async create(
    context: TeacherSubstitutionAuditContext,
    scheduleId: string,
    input: CreateTeacherSubstitutionInput,
    auditReason?: string,
  ) {
    const institutionId = context.auth.institutionId;
    return withSubstitutionTransaction(async (tx) => {
      await lockSchedule(tx, institutionId, scheduleId);
      const details = await scheduleDetails(
        tx,
        institutionId,
        scheduleId,
        input.substitutionDate,
      );
      if (details.session && details.session.status !== "OPEN") {
        throw new TeacherSubstitutionConflictError(
          "Substitution cannot be created for a finalized or cancelled session.",
        );
      }
      assertSubstitutionRange(
        input,
        details.primaryTeacherId,
        details.startTime,
        details.endTime,
      );
      const substitute = await tx.teacher.findFirst({
        where: {
          id: input.substituteTeacherId,
          institutionId,
        },
        select: { id: true },
      });
      if (!substitute) {
        throw new TeacherSubstitutionNotFoundError(
          "Substitute teacher not found in the authenticated institution.",
        );
      }
      const row = await tx.teacherSubstitution.create({
        data: {
          institutionId,
          scheduleId,
          substitutionDate: input.substitutionDate,
          originalTeacherId: details.primaryTeacherId,
          substituteTeacherId: input.substituteTeacherId,
          startTime: input.startTime,
          endTime: input.endTime,
          reason: input.reason,
          status: "PENDING",
        },
      });
      await writeAudit(
        tx,
        context,
        "CREATE",
        row.id,
        null,
        row,
        auditReason ?? input.reason,
      );
      return row;
    });
  }

  async approve(
    context: TeacherSubstitutionAuditContext,
    id: string,
    auditReason?: string,
  ) {
    return this.transition(context, id, "approve", auditReason);
  }

  async reject(
    context: TeacherSubstitutionAuditContext,
    id: string,
    auditReason?: string,
  ) {
    return this.transition(context, id, "reject", auditReason);
  }

  async cancel(
    context: TeacherSubstitutionAuditContext,
    id: string,
    auditReason?: string,
  ) {
    return this.transition(context, id, "cancel", auditReason);
  }

  private async transition(
    context: TeacherSubstitutionAuditContext,
    id: string,
    operation: "approve" | "reject" | "cancel",
    auditReason?: string,
  ) {
    const institutionId = context.auth.institutionId;
    return withSubstitutionTransaction(async (tx) => {
      const initial = await tx.teacherSubstitution.findFirst({
        where: { id, institutionId },
        select: { scheduleId: true },
      });
      if (!initial) throw new TeacherSubstitutionNotFoundError();
      await lockSchedule(tx, institutionId, initial.scheduleId);
      const before = await tx.teacherSubstitution.findFirst({
        where: { id, institutionId },
      });
      if (!before) throw new TeacherSubstitutionNotFoundError();

      if (operation === "approve" || operation === "reject") {
        if (before.status !== "PENDING") {
          const targetState = operation === "approve" ? "approved" : "rejected";
          throw new TeacherSubstitutionConflictError(
            `Only a PENDING substitution can be ${targetState}.`,
          );
        }
      } else if (
        before.status !== "PENDING" &&
        before.status !== "APPROVED"
      ) {
        throw new TeacherSubstitutionConflictError(
          "Only a PENDING or APPROVED substitution can be cancelled.",
        );
      }

      if (operation === "approve" || operation === "cancel") {
        let details = await scheduleDetails(
          tx,
          institutionId,
          before.scheduleId,
          before.substitutionDate,
        );
        if (details.session) {
          await lockAttendanceSession(
            tx,
            institutionId,
            details.session.id,
          );
          details = await scheduleDetails(
            tx,
            institutionId,
            before.scheduleId,
            before.substitutionDate,
          );
        }
        if (operation === "approve") {
          if (details.session && details.session.status !== "OPEN") {
            throw new TeacherSubstitutionConflictError(
              "Substitution cannot be approved for a finalized or cancelled session.",
            );
          }
          if (before.originalTeacherId !== details.primaryTeacherId) {
            throw new TeacherSubstitutionConflictError(
              "The scheduled primary teacher changed; create a new substitution request.",
            );
          }
          assertSubstitutionRange(
            before,
            details.primaryTeacherId,
            details.startTime,
            details.endTime,
          );
        }
        if (
          operation === "cancel" &&
          before.status === "APPROVED" &&
          details.session
        ) {
          if (details.session.status !== "OPEN") {
            throw new TeacherSubstitutionConflictError(
              "An approved substitution cannot be cancelled after the session ends.",
            );
          }
          const segments = await tx.attendanceSessionSegment.count({
            where: {
              institutionId,
              attendanceSessionId: details.session.id,
              teacherId: before.substituteTeacherId,
            },
          });
          if (segments > 0) {
            throw new TeacherSubstitutionConflictError(
              "An approved substitution cannot be cancelled after its teacher has opened a session segment.",
            );
          }
        }
      }

      const status =
        operation === "approve"
          ? "APPROVED"
          : operation === "reject"
            ? "REJECTED"
            : "CANCELLED";
      const row = await tx.teacherSubstitution.update({
        where: { id_institutionId: { id, institutionId } },
        data: {
          status,
          ...(operation === "approve"
            ? {
                approvedById: context.auth.userId,
                approvedByInstitutionId: institutionId,
                approvedAt: new Date(),
              }
            : {}),
        },
      });
      await writeAudit(
        tx,
        context,
        "UPDATE",
        row.id,
        before,
        row,
        auditReason,
      );
      return row;
    });
  }
}
