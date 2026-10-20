import { prisma } from "../../lib/prisma.js";
import { getIsoWeekday } from "../schedule/schedule.validation.js";
import {
  AttendanceEngineService,
  type AttendanceAuditContext,
} from "./attendance-engine.service.js";

type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

type LockedSession = Awaited<
  ReturnType<AttendanceSessionService["getLockedSession"]>
>;

function timeOfDayMilliseconds(value: Date): number {
  return (
    value.getUTCHours() * 60 * 60 * 1000 +
    value.getUTCMinutes() * 60 * 1000 +
    value.getUTCSeconds() * 1000
  );
}

export interface CreateAttendanceSessionInput {
  institutionId: string;
  scheduleId: string;
  sessionDate: Date;
}

export interface ListAttendanceSessionsInput {
  institutionId: string;
  sessionDate: Date;
}

export interface OpenSegmentInput {
  institutionId: string;
  sessionId: string;
  teacherId: string;
  startedAt: Date;
}

export interface HandoverInput {
  institutionId: string;
  sessionId: string;
  teacherId: string;
  handoverAt: Date;
  auditContext: AttendanceAuditContext;
}

export interface FinalizeInput {
  institutionId: string;
  sessionId: string;
  finalizedAt: Date;
  auditContext?: AttendanceAuditContext;
}

export interface CancelInput {
  institutionId: string;
  sessionId: string;
  cancelledAt: Date;
}

export interface AutoFinalizeExpiredSessionInput {
  institutionId: string;
  sessionId: string;
  now: Date;
  auditContext: AttendanceAuditContext;
}

export class AttendanceSessionService {
  constructor(
    private readonly attendanceEngine = new AttendanceEngineService(),
  ) {}

  async listByDate(input: ListAttendanceSessionsInput) {
    const rows = await prisma.attendanceSession.findMany({
      where: {
        institutionId: input.institutionId,
        sessionDate: input.sessionDate,
      },
      select: {
        id: true,
        scheduleId: true,
        sessionDate: true,
        status: true,
        primaryTeacherIdSnapshot: true,
        primaryTeacherNameSnapshot: true,
        classNameSnapshot: true,
        subjectNameSnapshot: true,
        startTimeSnapshot: true,
        endTimeSnapshot: true,
        scheduledJpSnapshot: true,
        segments: {
          where: { status: "OPEN" },
          select: { teacherId: true },
          take: 1,
        },
      },
      orderBy: [{ startTimeSnapshot: "asc" }, { id: "asc" }],
    });

    return rows.map(({ segments, ...session }) => ({
      ...session,
      openSegmentTeacherId: segments[0]?.teacherId ?? null,
    }));
  }

  /**
   * Serialization root untuk seluruh mutasi kritis
   * terhadap AttendanceSession.
   */
  async withSessionTransaction<T>(
    institutionId: string,
    sessionId: string,
    operation: (
      tx: PrismaTransaction,
      session: LockedSession,
    ) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const session = await this.getLockedSession(
        tx,
        institutionId,
        sessionId,
      );

      return operation(tx, session);
    });
  }

  /**
   * Membuat AttendanceSession dari Schedule.
   *
   * Session dibuat OPEN tanpa segment.
   * Segment baru dibuka melalui openSegment().
   */
  async createSession(input: CreateAttendanceSessionInput) {
    const { institutionId, scheduleId, sessionDate } = input;

    return prisma.$transaction(async (tx) => {
      // Load Schedule scalar terlebih dahulu.
      // Relation tidak menggunakan include agar PrismaPg tidak
      // menjalankan relation-loading path yang memicu warning.
      const scheduleRow = await tx.schedule.findUnique({
        where: {
          id_institutionId: {
            id: scheduleId,
            institutionId,
          },
        },
      });

      if (!scheduleRow) {
        throw new Error("Schedule not found");
      }

      // Load relation secara sequential.
      const primaryTeacher =
        await tx.teacher.findUnique({
          where: {
            id_institutionId: {
              id: scheduleRow.primaryTeacherId,
              institutionId,
            },
          },
        });

      const classRoom =
        await tx.class.findUnique({
          where: {
            id_institutionId: {
              id: scheduleRow.classId,
              institutionId,
            },
          },
        });

      const subject =
        await tx.subject.findUnique({
          where: {
            id_institutionId: {
              id: scheduleRow.subjectId,
              institutionId,
            },
          },
        });

      let subjectOffering = null;

      if (
        scheduleRow.subjectOfferingId &&
        scheduleRow.subjectOfferingInstitutionId
      ) {
        subjectOffering =
          await tx.subjectOffering.findUnique({
            where: {
              id_institutionId: {
                id: scheduleRow.subjectOfferingId,
                institutionId:
                  scheduleRow.subjectOfferingInstitutionId,
              },
            },
          });
      }

      let room = null;

      if (
        scheduleRow.roomId &&
        scheduleRow.roomInstitutionId
      ) {
        room = await tx.room.findUnique({
          where: {
            id_institutionId: {
              id: scheduleRow.roomId,
              institutionId:
                scheduleRow.roomInstitutionId,
            },
          },
        });
      }

      const startPeriod =
        await tx.schedulePeriod.findUnique({
          where: {
            institutionId_periodNumber: {
              institutionId,
              periodNumber:
                scheduleRow.startPeriodNumber,
            },
          },
        });

      const endPeriod =
        await tx.schedulePeriod.findUnique({
          where: {
            institutionId_periodNumber: {
              institutionId,
              periodNumber:
                scheduleRow.endPeriodNumber,
            },
          },
        });

      if (
        !primaryTeacher ||
        !classRoom ||
        !subject ||
        !startPeriod ||
        !endPeriod
      ) {
        throw new Error(
          "Schedule relation data is incomplete",
        );
      }

      // Bentuk kembali object schedule agar business logic
      // di bawah tetap menggunakan struktur yang sama seperti
      // hasil include sebelumnya.
      const schedule = {
        ...scheduleRow,
        primaryTeacher,
        class: classRoom,
        subject,
        subjectOffering,
        room,
        startPeriod,
        endPeriod,
      };

      if (!schedule) {
        throw new Error("Schedule not found");
      }

      const scheduleDay = schedule.dayOfWeek;
      const sessionDay = getIsoWeekday(sessionDate);

      if (scheduleDay !== sessionDay) {
        throw new Error("Session date does not match schedule day");
      }

      const existing = await tx.attendanceSession.findUnique({
        where: {
          scheduleId_sessionDate: {
            scheduleId,
            sessionDate,
          },
        },
      });

      if (existing) {
        throw new Error("AttendanceSession already exists");
      }

      const scheduledJp =
        schedule.endPeriodNumber -
        schedule.startPeriodNumber +
        1;

      if (scheduledJp <= 0) {
        throw new Error("Invalid scheduled JP");
      }

      return tx.attendanceSession.create({
        data: {
          institutionId,
          scheduleId,
          sessionDate,

          status: "OPEN",

          primaryTeacherIdSnapshot:
            schedule.primaryTeacherId,
          primaryTeacherCodeSnapshot:
            schedule.primaryTeacher.code,
          primaryTeacherNameSnapshot:
            schedule.primaryTeacher.name,

          classIdSnapshot:
            schedule.classId,
          classCodeSnapshot:
            schedule.class.code,
          classNameSnapshot:
            schedule.class.name,

          subjectIdSnapshot:
            schedule.subjectId,
          subjectCodeSnapshot:
            schedule.subject.code,
          subjectNameSnapshot:
            schedule.subject.name,

          subjectOfferingIdSnapshot:
            schedule.subjectOfferingId,

          roomIdSnapshot:
            schedule.roomId,
          roomCodeSnapshot:
            schedule.room?.code ?? null,
          roomNameSnapshot:
            schedule.room?.name ?? null,

          startPeriodNumberSnapshot:
            schedule.startPeriodNumber,
          endPeriodNumberSnapshot:
            schedule.endPeriodNumber,

          startTimeSnapshot:
            schedule.startPeriod.startTime,
          endTimeSnapshot:
            schedule.endPeriod.endTime,

          scheduledJpSnapshot: scheduledJp,
        },
      });
    });
  }

  /**
   * Membuka segment pertama.
   *
   * Hanya teacher yang legitimate yang boleh menjalankan
   * session:
   * - primary teacher; atau
   * - substitute resmi dengan status APPROVED.
   */
  async openSegment(input: OpenSegmentInput) {
    const {
      institutionId,
      sessionId,
      teacherId,
      startedAt,
    } = input;

    return this.withSessionTransaction(
      institutionId,
      sessionId,
      async (tx, session) => {
        this.assertSessionOpen(session);

        const existingOpen =
          await tx.attendanceSessionSegment.findFirst({
            where: {
              institutionId,
              attendanceSessionId: sessionId,
              status: "OPEN",
            },
          });

        if (existingOpen) {
          throw new Error(
            "AttendanceSession already has an open segment",
          );
        }

        await this.assertTeacherCanRunSession(
          tx,
          session,
          teacherId,
          startedAt,
        );

        return tx.attendanceSessionSegment.create({
          data: {
            institutionId,
            attendanceSessionId: sessionId,
            teacherId,
            startedAt,
            status: "OPEN",
            allocatedJp: 0,
          },
        });
      },
    );
  }

  /**
   * Handover atomik:
   * OPEN segment lama -> CLOSED
   * teacher baru -> OPEN
   *
   * Tetap menggunakan AttendanceSession yang sama.
   */
  async handover(input: HandoverInput) {
    const {
      institutionId,
      sessionId,
      teacherId,
      handoverAt,
    } = input;

    return this.withSessionTransaction(
      institutionId,
      sessionId,
      async (tx, session) => {
        this.assertSessionOpen(session);

        const openSegment =
          await tx.attendanceSessionSegment.findFirst({
            where: {
              institutionId,
              attendanceSessionId: sessionId,
              status: "OPEN",
            },
            orderBy: {
              startedAt: "asc",
            },
          });

        if (!openSegment) {
          throw new Error(
            "No open segment to handover",
          );
        }

        if (handoverAt <= openSegment.startedAt) {
          throw new Error(
            "Handover time must be after segment start",
          );
        }

        await this.assertTeacherMayEndSegment(
          tx,
          session,
          openSegment.teacherId,
          openSegment.startedAt,
          handoverAt,
        );
        await this.assertTeacherCanRunSession(
          tx,
          session,
          teacherId,
          handoverAt,
        );

        await tx.attendanceSessionSegment.update({
          where: {
            id_institutionId: {
              id: openSegment.id,
              institutionId,
            },
          },
          data: {
            endedAt: handoverAt,
            status: "CLOSED",
          },
        });

        const nextSegment = await tx.attendanceSessionSegment.create({
          data: {
            institutionId,
            attendanceSessionId: sessionId,
            teacherId,
            startedAt: handoverAt,
            status: "OPEN",
            allocatedJp: 0,
          },
        });
        await this.attendanceEngine.auditSegmentHandover(
          tx,
          input.auditContext,
          openSegment,
          {
            ...openSegment,
            endedAt: handoverAt,
            status: "CLOSED",
          },
          nextSegment,
        );
        return nextSegment;
      },
    );
  }

  /**
   * Finalisasi session.
   *
   * Segment OPEN ditutup terlebih dahulu.
   */
  async finalize(input: FinalizeInput) {
    const {
      institutionId,
      sessionId,
      finalizedAt,
    } = input;

    return this.withSessionTransaction(
      institutionId,
      sessionId,
      async (tx, session) => {
        this.assertSessionOpen(session);

        const openSegment =
          await tx.attendanceSessionSegment.findFirst({
            where: {
              institutionId,
              attendanceSessionId: sessionId,
              status: "OPEN",
            },
          });

        if (
          openSegment &&
          finalizedAt <= openSegment.startedAt
        ) {
          throw new Error(
            "Finalize time must be after segment start",
          );
        }

        if (openSegment) {
          const segmentEnd = await this.authorizedSegmentEnd(
            tx,
            session,
            openSegment.teacherId,
            openSegment.startedAt,
            finalizedAt,
          );
          await tx.attendanceSessionSegment.update({
            where: {
              id_institutionId: {
                id: openSegment.id,
                institutionId,
              },
            },
            data: {
              endedAt: segmentEnd,
              status: "CLOSED",
            },
          });
        }

        await this.attendanceEngine.finalizeWithinTransaction(
          tx,
          input.auditContext,
          session,
        );

        const finalized = await tx.attendanceSession.update({
          where: {
            id_institutionId: {
              id: sessionId,
              institutionId,
            },
          },
          data: {
            status: "FINALIZED",
            finalizedAt,
          },
        });
        await this.attendanceEngine.auditSessionFinalization(
          tx,
          input.auditContext,
          session,
          finalized,
        );
        return finalized;
      },
    );
  }

  /**
   * Membatalkan session.
   *
   * CANCELLED tidak menghasilkan alokasi JP.
   */
  /**
   * Auto-finalize session yang sudah mencapai/melewati
   * endTimeSnapshot.
   *
   * AttendanceSession tetap menjadi serialization root.
   * Pemeriksaan expired dilakukan setelah row session
   * dikunci oleh withSessionTransaction().
   */
  async autoFinalizeExpiredSession(
    input: AutoFinalizeExpiredSessionInput,
  ) {
    const {
      institutionId,
      sessionId,
      now,
    } = input;

    return this.withSessionTransaction(
      institutionId,
      sessionId,
      async (tx, session) => {
        this.assertSessionOpen(session);

        const endTime = session.endTimeSnapshot;

        if (!endTime) {
          throw new Error(
            "AttendanceSession end time snapshot is missing",
          );
        }

        const sessionDate = new Date(session.sessionDate);

        const endTimeDate = new Date(
          Date.UTC(
            sessionDate.getUTCFullYear(),
            sessionDate.getUTCMonth(),
            sessionDate.getUTCDate(),
            endTime.getUTCHours(),
            endTime.getUTCMinutes(),
            endTime.getUTCSeconds(),
            0,
          ),
        );

        if (now < endTimeDate) {
          throw new Error(
            "AttendanceSession has not reached its scheduled end time",
          );
        }

        const openSegment =
          await tx.attendanceSessionSegment.findFirst({
            where: {
              institutionId,
              attendanceSessionId: sessionId,
              status: "OPEN",
            },
            orderBy: {
              startedAt: "asc",
            },
          });

        if (openSegment) {
          const segmentEndedAt = await this.authorizedSegmentEnd(
            tx,
            session,
            openSegment.teacherId,
            openSegment.startedAt,
            endTimeDate,
          );

          if (segmentEndedAt <= openSegment.startedAt) {
            throw new Error(
              "Auto-finalize time must be after segment start",
            );
          }

          await tx.attendanceSessionSegment.update({
            where: {
              id_institutionId: {
                id: openSegment.id,
                institutionId,
              },
            },
            data: {
              endedAt: segmentEndedAt,
              status: "CLOSED",
            },
          });
        }

        await this.attendanceEngine.finalizeWithinTransaction(
          tx,
          input.auditContext,
          session,
        );

        const finalized = await tx.attendanceSession.update({
          where: {
            id_institutionId: {
              id: sessionId,
              institutionId,
            },
          },
          data: {
            status: "FINALIZED",
            finalizedAt: now,
          },
        });
        await this.attendanceEngine.auditSessionFinalization(
          tx,
          input.auditContext,
          session,
          finalized,
        );
        return finalized;
      },
    );
  }
  async cancel(input: CancelInput) {
    const {
      institutionId,
      sessionId,
      cancelledAt,
    } = input;

    return this.withSessionTransaction(
      institutionId,
      sessionId,
      async (tx, session) => {
        this.assertSessionOpen(session);

        const openSegment =
          await tx.attendanceSessionSegment.findFirst({
            where: {
              institutionId,
              attendanceSessionId: sessionId,
              status: "OPEN",
            },
          });

        if (
          openSegment &&
          cancelledAt <= openSegment.startedAt
        ) {
          throw new Error(
            "Cancel time must be after segment start",
          );
        }

        if (openSegment) {
          await tx.attendanceSessionSegment.update({
            where: {
              id_institutionId: {
                id: openSegment.id,
                institutionId,
              },
            },
            data: {
              endedAt: cancelledAt,
              status: "CLOSED",
              allocatedJp: 0,
            },
          });
        }

        await tx.attendanceSessionSegment.updateMany({
          where: {
            institutionId,
            attendanceSessionId: sessionId,
          },
          data: {
            allocatedJp: 0,
          },
        });

        return tx.attendanceSession.update({
          where: {
            id_institutionId: {
              id: sessionId,
              institutionId,
            },
          },
          data: {
            status: "CANCELLED",
            cancelledAt,
            finalizedAt: null,
          },
        });
      },
    );
  }

  private assertSessionOpen(session: LockedSession) {
    if (session.status !== "OPEN") {
      throw new Error(
        `AttendanceSession is not OPEN: ${session.status}`,
      );
    }
  }

  private async assertTeacherCanRunSession(
    tx: PrismaTransaction,
    session: LockedSession,
    teacherId: string,
    at: Date,
  ) {
    if (teacherId === session.primaryTeacherIdSnapshot) {
      return;
    }
    if (
      at.toISOString().slice(0, 10) !==
      session.sessionDate.toISOString().slice(0, 10)
    ) {
      throw new Error(
        "Substitute session segment must start on its approved substitution date.",
      );
    }

    const substitutions = await tx.teacherSubstitution.findMany({
        where: {
          institutionId: session.institutionId,
          scheduleId: session.scheduleId,
          substitutionDate: session.sessionDate,
          originalTeacherId:
            session.primaryTeacherIdSnapshot,
          substituteTeacherId: teacherId,
          status: "APPROVED",
        },
      });

    const atTime = timeOfDayMilliseconds(at);
    const substitution = substitutions.find(
      (candidate) =>
        timeOfDayMilliseconds(candidate.startTime) <= atTime &&
        atTime < timeOfDayMilliseconds(candidate.endTime),
    );
    if (!substitution) {
      throw new Error(
        "Teacher is not authorized to run this session",
      );
    }
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "TeacherSubstitution"
      WHERE "id" = ${substitution.id}::uuid
        AND "institutionId" = ${session.institutionId}::uuid
        AND "status" = 'APPROVED'
      FOR SHARE
    `;
    if (lockedRows.length === 0) {
      throw new Error(
        "Teacher is not authorized to run this session",
      );
    }
  }

  private async assertTeacherMayEndSegment(
    tx: PrismaTransaction,
    session: LockedSession,
    teacherId: string,
    startedAt: Date,
    endedAt: Date,
  ): Promise<void> {
    if (teacherId === session.primaryTeacherIdSnapshot) return;
    const endLimit = await this.substitutionEndForSegment(
      tx,
      session,
      teacherId,
      startedAt,
    );
    if (!endLimit || endedAt > endLimit) {
      throw new Error(
        "Substitute segment cannot continue beyond its approved substitution interval.",
      );
    }
  }

  private async authorizedSegmentEnd(
    tx: PrismaTransaction,
    session: LockedSession,
    teacherId: string,
    startedAt: Date,
    requestedEnd: Date,
  ): Promise<Date> {
    if (teacherId === session.primaryTeacherIdSnapshot) return requestedEnd;
    const endLimit = await this.substitutionEndForSegment(
      tx,
      session,
      teacherId,
      startedAt,
    );
    if (!endLimit) {
      throw new Error(
        "Substitute segment has no matching approved substitution.",
      );
    }
    return requestedEnd > endLimit ? endLimit : requestedEnd;
  }

  private async substitutionEndForSegment(
    tx: PrismaTransaction,
    session: LockedSession,
    teacherId: string,
    startedAt: Date,
  ): Promise<Date | null> {
    const substitutions = await tx.teacherSubstitution.findMany({
      where: {
        institutionId: session.institutionId,
        scheduleId: session.scheduleId,
        substitutionDate: session.sessionDate,
        originalTeacherId: session.primaryTeacherIdSnapshot,
        substituteTeacherId: teacherId,
        status: "APPROVED",
      },
    });
    const startTime = timeOfDayMilliseconds(startedAt);
    const substitution = substitutions.find(
      (candidate) =>
        timeOfDayMilliseconds(candidate.startTime) <= startTime &&
        startTime < timeOfDayMilliseconds(candidate.endTime),
    );
    if (!substitution) return null;
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "TeacherSubstitution"
      WHERE "id" = ${substitution.id}::uuid
        AND "institutionId" = ${session.institutionId}::uuid
        AND "status" = 'APPROVED'
      FOR SHARE
    `;
    if (lockedRows.length === 0) return null;
    const sessionDay = new Date(session.sessionDate);
    return new Date(
      Date.UTC(
        sessionDay.getUTCFullYear(),
        sessionDay.getUTCMonth(),
        sessionDay.getUTCDate(),
        substitution.endTime.getUTCHours(),
        substitution.endTime.getUTCMinutes(),
        substitution.endTime.getUTCSeconds(),
      ),
    );
  }

  private async getLockedSession(
    tx: PrismaTransaction,
    institutionId: string,
    sessionId: string,
  ) {
    const lockedRows =
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AttendanceSession"
        WHERE "id" = ${sessionId}::uuid
          AND "institutionId" = ${institutionId}::uuid
        FOR UPDATE
      `;

    if (lockedRows.length === 0) {
      throw new Error("AttendanceSession not found");
    }

    const session =
      await tx.attendanceSession.findUnique({
        where: {
          id_institutionId: {
            id: sessionId,
            institutionId,
          },
        },
      });

    if (!session) {
      throw new Error("AttendanceSession not found");
    }

    return session;
  }
}
