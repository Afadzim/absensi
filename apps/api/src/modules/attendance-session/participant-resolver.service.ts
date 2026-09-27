import { prisma } from "../../lib/prisma.js";

type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

export type ParticipantResolverInput = {
  institutionId: string;
  scheduleId: string;
  sessionDate: string;
};

export type ResolvedParticipant = {
  studentId: string;
  studentCode: string;
  studentName: string;
  classId: string;
  classCode: string;
  className: string;
};

type EffectiveOverride = {
  studentId: string;
  action: "INCLUDE" | "EXCLUDE";
};

function parseSessionDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("sessionDate must use YYYY-MM-DD format");
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid sessionDate");
  }

  return date;
}

function dateOnly(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ),
  );
}

export class ParticipantResolverService {
  /**
   * Resolve roster peserta final untuk satu Schedule
   * pada tanggal pembelajaran tertentu.
   *
   * Aturan:
   *
   * ELECTIVE:
   *   Schedule -> SubjectOffering -> StudentSubjectChoice
   *
   * REGULAR:
   *   Schedule -> satu ScheduleClassParticipant
   *   -> StudentClassEnrollment
   *
   * GROUPING:
   *   Schedule -> banyak ScheduleClassParticipant
   *   -> StudentClassEnrollment
   *
   * Setelah roster dasar terbentuk:
   *   ScheduleStudentParticipant INCLUDE / EXCLUDE
   * diterapkan sebagai override konkret schedule.
   *
   * Resolver TIDAK mengubah:
   *   - StudentSubjectChoice
   *   - StudentClassEnrollment
   *   - Schedule
   */
  async resolve(
    input: ParticipantResolverInput,
  ): Promise<ResolvedParticipant[]> {
    return this.resolveWithTransaction(prisma, input);
  }

  async resolveWithTransaction(
    tx: PrismaTransaction,
    input: ParticipantResolverInput,
  ): Promise<ResolvedParticipant[]> {
    const sessionDate = parseSessionDate(input.sessionDate);

    const schedule = await tx.schedule.findUnique({
      where: {
        id_institutionId: {
          id: input.scheduleId,
          institutionId: input.institutionId,
        },
      },
      include: {
        subjectOffering: true,
        classParticipants: {
          include: {
            class: true,
          },
          orderBy: {
            classId: "asc",
          },
        },
      },
    });

    if (!schedule) {
      throw new Error("Schedule not found");
    }

    /**
     * Validasi dasar tenant.
     *
     * Composite relation pada schema sudah membantu,
     * tetapi service tetap wajib menjaga tenant isolation.
     */
    if (schedule.institutionId !== input.institutionId) {
      throw new Error("Schedule does not belong to institution");
    }

    const offeringType = schedule.subjectOffering?.offeringType;

    let baseParticipants: ResolvedParticipant[];

    if (offeringType === "ELECTIVE") {
      baseParticipants = await this.resolveElective(
        tx,
        input.institutionId,
        schedule.id,
        schedule.subjectOfferingId,
        sessionDate,
      );
    } else {
      baseParticipants = await this.resolveClassBased(
        tx,
        input.institutionId,
        schedule.classParticipants,
        sessionDate,
      );
    }

    const overrides = await this.loadEffectiveOverrides(
      tx,
      input.institutionId,
      schedule.id,
      sessionDate,
    );

    const finalParticipants = await this.applyOverrides(
      tx,
      input.institutionId,
      baseParticipants,
      overrides,
      sessionDate,
    );

    return this.sortParticipants(finalParticipants);
  }

  /**
   * REGULAR / GROUPING
   *
   * 1 class participant  -> REGULAR
   * >1 class participant -> GROUPING
   * 0 class participant  -> invalid schedule
   */
  private async resolveClassBased(
    tx: PrismaTransaction,
    institutionId: string,
    classParticipants: Array<{
      classId: string;
      class: {
        id: string;
        code: string;
        name: string;
        institutionId: string;
      };
    }>,
    sessionDate: Date,
  ): Promise<ResolvedParticipant[]> {
    if (classParticipants.length === 0) {
      throw new Error(
        "Schedule has no ScheduleClassParticipant; cannot resolve REGULAR/GROUPING roster",
      );
    }

    const classIds = [
      ...new Set(classParticipants.map((participant) => participant.classId)),
    ];

    const enrollments = await tx.studentClassEnrollment.findMany({
      where: {
        institutionId,
        classId: {
          in: classIds,
        },
        validFrom: {
          lte: sessionDate,
        },
        OR: [
          {
            validTo: null,
          },
          {
            validTo: {
              gte: sessionDate,
            },
          },
        ],
      },
      include: {
        student: true,
        class: true,
      },
      orderBy: [
        {
          classId: "asc",
        },
        {
          studentId: "asc",
        },
      ],
    });

    return this.normalizeEnrollments(enrollments);
  }

  /**
   * ELECTIVE
   *
   * Schedule
   *   -> SubjectOffering
   *   -> StudentSubjectChoice
   *
   * Hanya choice:
   *   status = ACTIVE
   *   effectiveFrom <= sessionDate
   *   effectiveTo IS NULL atau >= sessionDate
   *
   * yang menjadi roster dasar.
   */
  private async resolveElective(
    tx: PrismaTransaction,
    institutionId: string,
    scheduleId: string,
    subjectOfferingId: string | null,
    sessionDate: Date,
  ): Promise<ResolvedParticipant[]> {
    if (!subjectOfferingId) {
      throw new Error(
        `Schedule ${scheduleId} is ELECTIVE but has no SubjectOffering`,
      );
    }

    const choices = await tx.studentSubjectChoice.findMany({
      where: {
        institutionId,
        subjectOfferingId,
        status: "ACTIVE",
        effectiveFrom: {
          lte: sessionDate,
        },
        OR: [
          {
            effectiveTo: null,
          },
          {
            effectiveTo: {
              gte: sessionDate,
            },
          },
        ],
      },
      include: {
        student: true,
      },
      orderBy: {
        studentId: "asc",
      },
    });

    if (choices.length === 0) {
      return [];
    }

    const studentIds = [
      ...new Set(choices.map((choice) => choice.studentId)),
    ];

    return this.resolveStudentsCurrentClass(
      tx,
      institutionId,
      studentIds,
      sessionDate,
    );
  }

  /**
   * Mengambil kelas administratif siswa pada tanggal session.
   *
   * Kita tidak menyimpan classId pada Student.
   * Class snapshot ditentukan dari StudentClassEnrollment.
   *
   * Jika satu siswa memiliki lebih dari satu enrollment
   * aktif pada tanggal yang sama, resolver menolak data tersebut
   * karena status administratifnya ambigu.
   */
  private async resolveStudentsCurrentClass(
    tx: PrismaTransaction,
    institutionId: string,
    studentIds: string[],
    sessionDate: Date,
  ): Promise<ResolvedParticipant[]> {
    const enrollments = await tx.studentClassEnrollment.findMany({
      where: {
        institutionId,
        studentId: {
          in: studentIds,
        },
        validFrom: {
          lte: sessionDate,
        },
        OR: [
          {
            validTo: null,
          },
          {
            validTo: {
              gte: sessionDate,
            },
          },
        ],
      },
      include: {
        student: true,
        class: true,
      },
      orderBy: [
        {
          studentId: "asc",
        },
        {
          validFrom: "desc",
        },
      ],
    });

    const byStudent = new Map<
      string,
      typeof enrollments
    >();

    for (const enrollment of enrollments) {
      const existing = byStudent.get(enrollment.studentId) ?? [];
      existing.push(enrollment);
      byStudent.set(enrollment.studentId, existing);
    }

    const selected = [];

    for (const studentId of studentIds) {
      const rows = byStudent.get(studentId) ?? [];

      if (rows.length === 0) {
        throw new Error(
          `Student ${studentId} has no active class enrollment on ${formatDate(
            sessionDate,
          )}`,
        );
      }

      if (rows.length > 1) {
        throw new Error(
          `Student ${studentId} has multiple active class enrollments on ${formatDate(
            sessionDate,
          )}`,
        );
      }

      selected.push(rows[0]);
    }

    return this.normalizeEnrollments(selected);
  }

  /**
   * Ambil override yang aktif pada tanggal session.
   *
   * Bila ada lebih dari satu override aktif untuk siswa yang sama,
   * resolver menolak data karena aturan prioritas belum didefinisikan
   * dan memilih salah satu secara diam-diam akan berbahaya.
   */
  private async loadEffectiveOverrides(
    tx: PrismaTransaction,
    institutionId: string,
    scheduleId: string,
    sessionDate: Date,
  ): Promise<EffectiveOverride[]> {
    const rows = await tx.scheduleStudentParticipant.findMany({
      where: {
        institutionId,
        scheduleId,
        effectiveFrom: {
          lte: sessionDate,
        },
        OR: [
          {
            effectiveTo: null,
          },
          {
            effectiveTo: {
              gte: sessionDate,
            },
          },
        ],
      },
      select: {
        studentId: true,
        action: true,
      },
      orderBy: [
        {
          studentId: "asc",
        },
        {
          effectiveFrom: "desc",
        },
      ],
    });

    const byStudent = new Map<string, EffectiveOverride[]>();

    for (const row of rows) {
      const existing = byStudent.get(row.studentId) ?? [];

      existing.push({
        studentId: row.studentId,
        action: row.action,
      });

      byStudent.set(row.studentId, existing);
    }

    const result: EffectiveOverride[] = [];

    for (const [studentId, studentOverrides] of byStudent) {
      if (studentOverrides.length > 1) {
        throw new Error(
          `Multiple active ScheduleStudentParticipant overrides found for student ${studentId} on ${formatDate(
            sessionDate,
          )}`,
        );
      }

      result.push(studentOverrides[0]);
    }

    return result;
  }

  /**
   * Apply INCLUDE / EXCLUDE.
   *
   * INCLUDE:
   *   menambahkan siswa ke roster konkret schedule.
   *
   * EXCLUDE:
   *   menghapus siswa dari roster.
   *
   * Override tidak mengubah StudentSubjectChoice.
   */
  private async applyOverrides(
    tx: PrismaTransaction,
    institutionId: string,
    baseParticipants: ResolvedParticipant[],
    overrides: EffectiveOverride[],
    sessionDate: Date,
  ): Promise<ResolvedParticipant[]> {
    const participantMap = new Map<string, ResolvedParticipant>();

    for (const participant of baseParticipants) {
      participantMap.set(participant.studentId, participant);
    }

    const includeStudentIds: string[] = [];

    for (const override of overrides) {
      if (override.action === "EXCLUDE") {
        participantMap.delete(override.studentId);
        continue;
      }

      if (override.action === "INCLUDE") {
        if (!participantMap.has(override.studentId)) {
          includeStudentIds.push(override.studentId);
        }
      }
    }

    if (includeStudentIds.length > 0) {
      const includedParticipants = await this.resolveStudentsCurrentClass(
        tx,
        institutionId,
        includeStudentIds,
        sessionDate,
      );

      for (const participant of includedParticipants) {
        participantMap.set(participant.studentId, participant);
      }
    }

    return [...participantMap.values()];
  }

  private normalizeEnrollments(
    enrollments: Array<{
      studentId: string;
      student: {
        id: string;
        code: string;
        name: string;
        institutionId: string;
      };
      classId: string;
      class: {
        id: string;
        code: string;
        name: string;
        institutionId: string;
      };
    }>,
  ): ResolvedParticipant[] {
    const result = new Map<string, ResolvedParticipant>();

    for (const enrollment of enrollments) {
      if (
        enrollment.student.institutionId !== enrollment.class.institutionId
      ) {
        throw new Error(
          `Cross-institution student/class relationship detected for student ${enrollment.studentId}`,
        );
      }

      result.set(enrollment.studentId, {
        studentId: enrollment.student.id,
        studentCode: enrollment.student.code,
        studentName: enrollment.student.name,
        classId: enrollment.class.id,
        classCode: enrollment.class.code,
        className: enrollment.class.name,
      });
    }

    return [...result.values()];
  }

  private sortParticipants(
    participants: ResolvedParticipant[],
  ): ResolvedParticipant[] {
    return [...participants].sort((a, b) => {
      const classCompare = a.classCode.localeCompare(b.classCode);

      if (classCompare !== 0) {
        return classCompare;
      }

      return a.studentCode.localeCompare(b.studentCode);
    });
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}