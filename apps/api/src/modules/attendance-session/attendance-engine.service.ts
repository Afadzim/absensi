import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthContext } from "../auth/auth.context.js";
import { ParticipantResolverService } from "./participant-resolver.service.js";

type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

type SessionRecord = Prisma.AttendanceSessionGetPayload<Record<string, never>>;

const attendanceDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: process.env.ATTENDANCE_TIME_ZONE?.trim() || "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface AttendanceAuditContext {
  auth: AuthContext;
  requestId: string;
  ipAddress: string;
  userAgent?: string;
}

export type StudentAdministrativeStatusType = "IZIN" | "SAKIT" | "PENUGASAN";

export interface GateCheckInInput {
  studentId: string;
  eventAt: Date;
  clientEventId: string;
  source?: string;
}

export interface StudentAdministrativeStatusInput {
  studentId?: string;
  type?: StudentAdministrativeStatusType;
  validFrom?: Date;
  validTo?: Date | null;
  reason?: string | null;
}

export interface StudentAttendanceRosterItem {
  studentId: string;
  studentCode: string;
  studentName: string;
  classId: string;
  classCode: string;
  className: string;
  gateCheckedIn: boolean;
  administrativeStatus: StudentAdministrativeStatusType | null;
  administrativeStatusId: string | null;
  effectiveStatus: "NORMAL" | StudentAdministrativeStatusType;
  canCheck: boolean;
  attendanceStatus: string | null;
}

export class AttendanceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceInputError";
  }
}

export class AttendanceNotFoundError extends Error {
  constructor(message = "Attendance record not found.") {
    super(message);
    this.name = "AttendanceNotFoundError";
  }
}

export class AttendanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceConflictError";
  }
}

function jsonSnapshot(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  context: AttendanceAuditContext,
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
      beforeData: before ? jsonSnapshot(before) : Prisma.JsonNull,
      afterData: jsonSnapshot(after),
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
    throw new AttendanceNotFoundError("Institution not found.");
  }
}

function scheduleInstant(sessionDate: Date, time: Date): Date {
  return new Date(
    Date.UTC(
      sessionDate.getUTCFullYear(),
      sessionDate.getUTCMonth(),
      sessionDate.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
    ),
  );
}

function attendanceDateAt(value: Date): Date {
  const parts = attendanceDateFormatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

function allocatedJp(
  segment: {
    startedAt: Date;
    endedAt: Date | null;
  },
  session: SessionRecord,
): Prisma.Decimal {
  if (!segment.endedAt) {
    throw new AttendanceConflictError(
      "A session segment must be closed before finalization.",
    );
  }
  const scheduledStart = scheduleInstant(
    session.sessionDate,
    session.startTimeSnapshot,
  );
  const scheduledEnd = scheduleInstant(
    session.sessionDate,
    session.endTimeSnapshot,
  );
  const scheduledMilliseconds =
    scheduledEnd.getTime() - scheduledStart.getTime();
  if (scheduledMilliseconds <= 0) {
    throw new AttendanceConflictError(
      "The schedule snapshot has an invalid time range.",
    );
  }
  const actualStart = Math.max(segment.startedAt.getTime(), scheduledStart.getTime());
  const actualEnd = Math.min(segment.endedAt.getTime(), scheduledEnd.getTime());
  const actualMilliseconds = Math.max(0, actualEnd - actualStart);
  const scheduledJp = Number(session.scheduledJpSnapshot);
  const result = Math.min(
    scheduledJp,
    (actualMilliseconds / scheduledMilliseconds) * scheduledJp,
  );
  return new Prisma.Decimal(result.toFixed(8));
}

export class AttendanceEngineService {
  constructor(
    private readonly participantResolver = new ParticipantResolverService(),
  ) {}

  async createGateCheckIn(
    context: AttendanceAuditContext,
    input: GateCheckInInput,
  ) {
    const institutionId = context.auth.institutionId;
    try {
      return await prisma.$transaction(async (tx) => {
        const student = await tx.student.findFirst({
          where: { id: input.studentId, institutionId },
          select: { id: true },
        });
        if (!student) {
          throw new AttendanceNotFoundError(
            "Student not found in the authenticated institution.",
          );
        }

        const existing = await tx.gateEvent.findUnique({
          where: {
            institutionId_clientEventId: {
              institutionId,
              clientEventId: input.clientEventId,
            },
          },
        });
        if (existing) {
          if (
            existing.studentId !== input.studentId ||
            existing.eventAt.getTime() !== input.eventAt.getTime()
          ) {
            throw new AttendanceConflictError(
              "clientEventId was already used for a different gate event.",
            );
          }
          return { data: existing, duplicate: true };
        }

        const eventDate = attendanceDateAt(input.eventAt);
        const row = await tx.gateEvent.create({
          data: {
            institutionId,
            studentId: student.id,
            eventAt: input.eventAt,
            eventDate,
            clientEventId: input.clientEventId,
            source: input.source ?? "API",
          },
        });
        await writeAudit(
          tx,
          context,
          "CREATE",
          "GateEvent",
          row.id,
          null,
          row,
          "gate-check-in",
        );
        return { data: row, duplicate: false };
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      const racedEvent = await prisma.gateEvent.findUnique({
        where: {
          institutionId_clientEventId: {
            institutionId,
            clientEventId: input.clientEventId,
          },
        },
      });
      if (!racedEvent) throw error;
      if (
        racedEvent.studentId !== input.studentId ||
        racedEvent.eventAt.getTime() !== input.eventAt.getTime()
      ) {
        throw new AttendanceConflictError(
          "clientEventId was already used for a different gate event.",
        );
      }
      return { data: racedEvent, duplicate: true };
    }
  }

  async createStudentAdministrativeStatus(
    context: AttendanceAuditContext,
    input: Required<Pick<StudentAdministrativeStatusInput, "studentId" | "type" | "validFrom">> &
      Pick<StudentAdministrativeStatusInput, "validTo" | "reason">,
    auditReason?: string,
  ) {
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      await lockInstitution(tx, institutionId);
      await this.assertStudentStatusReferences(
        tx,
        institutionId,
        input.studentId,
        input.validFrom,
        input.validTo ?? null,
      );
      const row = await tx.studentAdministrativeStatus.create({
        data: {
          institutionId,
          studentId: input.studentId,
          type: input.type,
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
          reason: input.reason ?? null,
          createdById: context.auth.userId,
        },
      });
      await writeAudit(
        tx,
        context,
        "CREATE",
        "StudentAdministrativeStatus",
        row.id,
        null,
        row,
        auditReason ?? input.reason ?? undefined,
      );
      return row;
    });
  }

  async updateStudentAdministrativeStatus(
    context: AttendanceAuditContext,
    id: string,
    input: StudentAdministrativeStatusInput,
    auditReason?: string,
  ) {
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      await lockInstitution(tx, institutionId);
      const before = await tx.studentAdministrativeStatus.findFirst({
        where: { id, institutionId },
      });
      if (!before) return null;
      const studentId = input.studentId ?? before.studentId;
      const validFrom = input.validFrom ?? before.validFrom;
      const validTo =
        input.validTo === undefined ? before.validTo : input.validTo;
      await this.assertStudentStatusReferences(
        tx,
        institutionId,
        studentId,
        validFrom,
        validTo,
        id,
      );
      const row = await tx.studentAdministrativeStatus.update({
        where: { id_institutionId: { id, institutionId } },
        data: {
          studentId,
          type: input.type ?? before.type,
          validFrom,
          validTo,
          reason: input.reason === undefined ? before.reason : input.reason,
        },
      });
      await writeAudit(
        tx,
        context,
        "UPDATE",
        "StudentAdministrativeStatus",
        id,
        before,
        row,
        auditReason,
      );
      return row;
    });
  }

  async getStudentRoster(
    institutionId: string,
    sessionId: string,
  ): Promise<StudentAttendanceRosterItem[]> {
    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId, institutionId },
    });
    if (!session) throw new AttendanceNotFoundError("Attendance session not found.");
    if (session.status === "CANCELLED") {
      throw new AttendanceConflictError(
        "A cancelled session has no student attendance roster.",
      );
    }
    const participants = await this.participantResolver.resolve({
      institutionId,
      scheduleId: session.scheduleId,
      sessionDate: session.sessionDate.toISOString().slice(0, 10),
    });
    return this.buildRoster(prisma, institutionId, session, participants);
  }

  async markStudentPresent(
    context: AttendanceAuditContext,
    sessionId: string,
    studentId: string,
    teacherId: string,
  ) {
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AttendanceSession"
        WHERE "id" = ${sessionId}::uuid
          AND "institutionId" = ${institutionId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AttendanceNotFoundError("Attendance session not found.");
      }
      const session = await tx.attendanceSession.findUniqueOrThrow({
        where: { id_institutionId: { id: sessionId, institutionId } },
      });
      if (session.status !== "OPEN") {
        throw new AttendanceConflictError(
          "Student attendance can only be marked on an OPEN session.",
        );
      }
      const activeSegment = await tx.attendanceSessionSegment.findFirst({
        where: {
          institutionId,
          attendanceSessionId: sessionId,
          status: "OPEN",
        },
      });
      if (!activeSegment || activeSegment.teacherId !== teacherId) {
        throw new AttendanceConflictError(
          "Only the teacher on the current OPEN segment may mark student attendance.",
        );
      }

      const existing = await tx.studentAttendance.findUnique({
        where: {
          attendanceSessionId_studentId: { attendanceSessionId: sessionId, studentId },
        },
      });
      if (existing) {
        if (existing.status === "HADIR") return existing;
        throw new AttendanceConflictError(
          "Student already has a non-editable attendance status for this session.",
        );
      }

      const participants = await this.participantResolver.resolveWithTransaction(
        tx,
        {
          institutionId,
          scheduleId: session.scheduleId,
          sessionDate: session.sessionDate.toISOString().slice(0, 10),
        },
      );
      const participant = participants.find((item) => item.studentId === studentId);
      if (!participant) {
        throw new AttendanceNotFoundError(
          "Student is not a participant in this scheduled learning unit.",
        );
      }
      const gateEvent = await tx.gateEvent.findFirst({
        where: {
          institutionId,
          studentId,
          eventDate: session.sessionDate,
        },
        select: { id: true },
      });
      if (!gateEvent) {
        throw new AttendanceConflictError(
          "Student must have a valid gate check-in on the session date.",
        );
      }

      const row = await tx.studentAttendance.create({
        data: {
          institutionId,
          attendanceSessionId: sessionId,
          studentId,
          studentCodeSnapshot: participant.studentCode,
          studentNameSnapshot: participant.studentName,
          classIdSnapshot: participant.classId,
          classCodeSnapshot: participant.classCode,
          classNameSnapshot: participant.className,
          status: "HADIR",
        },
      });
      await writeAudit(
        tx,
        context,
        "CREATE",
        "StudentAttendance",
        row.id,
        null,
        row,
        "teacher-marked-present",
      );
      return row;
    });
  }

  async finalizeWithinTransaction(
    tx: PrismaTransaction,
    context: AttendanceAuditContext | undefined,
    session: SessionRecord,
  ): Promise<void> {
    const institutionId = session.institutionId;
    const segments = await tx.attendanceSessionSegment.findMany({
      where: {
        institutionId,
        attendanceSessionId: session.id,
      },
      include: { teacher: { select: { id: true, code: true, name: true } } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    });
    const allocatedByTeacher = new Map<string, Prisma.Decimal>();
    for (const segment of segments) {
      const allocated = allocatedJp(segment, session);
      await tx.attendanceSessionSegment.update({
        where: {
          id_institutionId: { id: segment.id, institutionId },
        },
        data: { allocatedJp: allocated },
      });
      allocatedByTeacher.set(
        segment.teacherId,
        (allocatedByTeacher.get(segment.teacherId) ?? new Prisma.Decimal(0)).plus(
          allocated,
        ),
      );
    }

    const primaryAdminStatuses = await tx.teacherAdministrativeStatus.findMany({
      where: {
        institutionId,
        teacherId: session.primaryTeacherIdSnapshot,
        validFrom: { lte: session.sessionDate },
        OR: [
          { validTo: null },
          { validTo: { gte: session.sessionDate } },
        ],
      },
    });
    if (primaryAdminStatuses.length > 1) {
      throw new AttendanceConflictError(
        "Multiple active administrative statuses exist for the primary teacher.",
      );
    }
    const adminStatus = primaryAdminStatuses[0];
    const segmentTeachers = new Map(
      segments.map(({ teacher }) => [teacher.id, teacher]),
    );
    const primaryTeacher = await tx.teacher.findUnique({
      where: {
        id_institutionId: {
          id: session.primaryTeacherIdSnapshot,
          institutionId,
        },
      },
      select: { id: true, code: true, name: true },
    });
    if (!primaryTeacher) {
      throw new AttendanceNotFoundError(
        "Primary teacher snapshot no longer exists in this institution.",
      );
    }
    segmentTeachers.set(primaryTeacher.id, primaryTeacher);

    for (const [teacherId, teacher] of segmentTeachers) {
      const isPrimary = teacherId === session.primaryTeacherIdSnapshot;
      const status = isPrimary && adminStatus
        ? adminStatus.type
        : allocatedByTeacher.has(teacherId)
          ? "HADIR"
          : "ALPA";
      const allocated = allocatedByTeacher.get(teacherId) ?? new Prisma.Decimal(0);
      const attendance = await tx.teacherAttendance.create({
        data: {
          institutionId,
          attendanceSessionId: session.id,
          scheduleId: session.scheduleId,
          teacherId,
          attendanceDate: session.sessionDate,
          teacherCodeSnapshot: teacher.code,
          teacherNameSnapshot: teacher.name,
          assignedJp: session.scheduledJpSnapshot,
          allocatedJp: isPrimary && adminStatus
            ? new Prisma.Decimal(0)
            : allocated,
          status,
        },
      });
      if (context) {
        await writeAudit(
          tx,
          context,
          "CREATE",
          "TeacherAttendance",
          attendance.id,
          null,
          attendance,
          "session-finalized",
        );
      }
    }

    if (segments.length === 0) return;

    const participants = await this.participantResolver.resolveWithTransaction(
      tx,
      {
        institutionId,
        scheduleId: session.scheduleId,
        sessionDate: session.sessionDate.toISOString().slice(0, 10),
      },
    );
    const studentIds = participants.map(({ studentId }) => studentId);
    const [gateEvents, adminStatuses, existingAttendance] = await Promise.all([
      tx.gateEvent.findMany({
        where: {
          institutionId,
          studentId: { in: studentIds },
          eventDate: session.sessionDate,
        },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
      tx.studentAdministrativeStatus.findMany({
        where: {
          institutionId,
          studentId: { in: studentIds },
          validFrom: { lte: session.sessionDate },
          OR: [
            { validTo: null },
            { validTo: { gte: session.sessionDate } },
          ],
        },
      }),
      tx.studentAttendance.findMany({
        where: { institutionId, attendanceSessionId: session.id },
        select: { studentId: true, status: true },
      }),
    ]);
    const gateStudentIds = new Set(gateEvents.map(({ studentId }) => studentId));
    const adminByStudent = new Map(
      adminStatuses.map((status) => [status.studentId, status]),
    );
    if (adminByStudent.size !== adminStatuses.length) {
      throw new AttendanceConflictError(
        "Multiple active administrative statuses exist for a student.",
      );
    }
    const existingByStudent = new Map(
      existingAttendance.map((attendance) => [
        attendance.studentId,
        attendance.status,
      ]),
    );

    for (const participant of participants) {
      const admin = adminByStudent.get(participant.studentId);
      const checkedIn = gateStudentIds.has(participant.studentId);
      const markedStatus = existingByStudent.get(participant.studentId);
      let status: "HADIR" | "IZIN" | "SAKIT" | "PENUGASAN" | "ALPA" | null =
        null;
      if (markedStatus === "HADIR") {
        status = "HADIR";
      } else if (admin && !checkedIn) {
        status = admin.type;
      } else if (checkedIn) {
        status = "ALPA";
      }
      if (!status || markedStatus) continue;

      const attendance = await tx.studentAttendance.create({
        data: {
          institutionId,
          attendanceSessionId: session.id,
          studentId: participant.studentId,
          studentCodeSnapshot: participant.studentCode,
          studentNameSnapshot: participant.studentName,
          classIdSnapshot: participant.classId,
          classCodeSnapshot: participant.classCode,
          classNameSnapshot: participant.className,
          status,
        },
      });
      if (context) {
        await writeAudit(
          tx,
          context,
          "CREATE",
          "StudentAttendance",
          attendance.id,
          null,
          attendance,
          "session-finalized",
        );
      }
    }
  }

  async auditSegmentHandover(
    tx: PrismaTransaction,
    context: AttendanceAuditContext,
    before: Prisma.AttendanceSessionSegmentGetPayload<Record<string, never>>,
    closed: Prisma.AttendanceSessionSegmentGetPayload<Record<string, never>>,
    opened: Prisma.AttendanceSessionSegmentGetPayload<Record<string, never>>,
  ): Promise<void> {
    await writeAudit(
      tx,
      context,
      "UPDATE",
      "AttendanceSessionSegment",
      closed.id,
      before,
      closed,
      "teacher-handover-outgoing-segment",
    );
    await writeAudit(
      tx,
      context,
      "CREATE",
      "AttendanceSessionSegment",
      opened.id,
      null,
      opened,
      "teacher-handover-incoming-segment",
    );
  }

  async auditSessionFinalization(
    tx: PrismaTransaction,
    context: AttendanceAuditContext | undefined,
    before: SessionRecord,
    after: SessionRecord,
  ): Promise<void> {
    if (!context) return;
    await writeAudit(
      tx,
      context,
      "UPDATE",
      "AttendanceSession",
      after.id,
      before,
      after,
      "session-finalized",
    );
  }

  private async assertStudentStatusReferences(
    tx: Prisma.TransactionClient,
    institutionId: string,
    studentId: string,
    validFrom: Date,
    validTo: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const student = await tx.student.findFirst({
      where: { id: studentId, institutionId },
      select: { id: true },
    });
    if (!student) {
      throw new AttendanceNotFoundError(
        "Student not found in the authenticated institution.",
      );
    }
    const overlap = await tx.studentAdministrativeStatus.findFirst({
      where: {
        institutionId,
        studentId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...(validTo ? { validFrom: { lte: validTo } } : {}),
        OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new AttendanceConflictError(
        "Student administrative status dates must not overlap.",
      );
    }
  }

  private async buildRoster(
    tx: PrismaTransaction,
    institutionId: string,
    session: SessionRecord,
    participants: Awaited<ReturnType<ParticipantResolverService["resolve"]>>,
  ): Promise<StudentAttendanceRosterItem[]> {
    const studentIds = participants.map(({ studentId }) => studentId);
    if (studentIds.length === 0) return [];
    const [gateEvents, adminStatuses, attendance] = await Promise.all([
      tx.gateEvent.findMany({
        where: {
          institutionId,
          studentId: { in: studentIds },
          eventDate: session.sessionDate,
        },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
      tx.studentAdministrativeStatus.findMany({
        where: {
          institutionId,
          studentId: { in: studentIds },
          validFrom: { lte: session.sessionDate },
          OR: [
            { validTo: null },
            { validTo: { gte: session.sessionDate } },
          ],
        },
      }),
      tx.studentAttendance.findMany({
        where: { institutionId, attendanceSessionId: session.id },
        select: { studentId: true, status: true },
      }),
    ]);
    const gateStudentIds = new Set(gateEvents.map(({ studentId }) => studentId));
    const adminByStudent = new Map(
      adminStatuses.map((status) => [status.studentId, status]),
    );
    if (adminByStudent.size !== adminStatuses.length) {
      throw new AttendanceConflictError(
        "Multiple active administrative statuses exist for a student.",
      );
    }
    const attendanceByStudent = new Map(
      attendance.map((row) => [row.studentId, row.status]),
    );
    return participants.flatMap((participant) => {
      const gateCheckedIn = gateStudentIds.has(participant.studentId);
      const admin = adminByStudent.get(participant.studentId);
      if (!gateCheckedIn && !admin) return [];
      const effectiveStatus = gateCheckedIn ? "NORMAL" : admin!.type;
      return [{
        ...participant,
        gateCheckedIn,
        administrativeStatus: admin?.type ?? null,
        administrativeStatusId: admin?.id ?? null,
        effectiveStatus,
        canCheck: session.status === "OPEN" && gateCheckedIn,
        attendanceStatus: attendanceByStudent.get(participant.studentId) ?? null,
      }];
    });
  }
}
