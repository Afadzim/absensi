import { testPrisma } from "../../test/db.js";

export type AttendanceSessionLifecycleFixture = {
  institutionId: string;
  scheduleId: string;
  teacherId: string;
  substituteTeacherId: string;
  approverUserId: string;
  classId: string;
  subjectId: string;
  academicYearId: string;
  semesterId: string;
  sessionDate: Date;
  startPeriodNumber: number;
  endPeriodNumber: number;
  cleanup: () => Promise<void>;
};

const SESSION_DATE = new Date("2026-09-25T00:00:00.000Z");

function time(hour: number, minute: number): Date {
  return new Date(
    `1970-01-01T${String(hour).padStart(2, "0")}:${String(
      minute,
    ).padStart(2, "0")}:00.000Z`,
  );
}

function suffix(): string {
  return `${Date.now().toString().slice(-8)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export async function createAttendanceSessionLifecycleFixture(): Promise<AttendanceSessionLifecycleFixture> {
  const s = suffix();
  const code = `ASL-${s}`;

  const institution = await testPrisma.institution.create({
    data: {
      code: `INST-${code}`,
      name: `Attendance Session Lifecycle Test ${code}`,
    },
  });

  const approver = await testPrisma.user.create({
    data: {
      institutionId: institution.id,
      username: `approver-${s}`,
      passwordHash: "TEST_ONLY_HASH",
      status: "ACTIVE",
    },
  });

  const academicYear = await testPrisma.academicYear.create({
    data: {
      institutionId: institution.id,
      code: `2026-${s}`,
      name: `2026/2027 ${code}`,
    },
  });

  const semester = await testPrisma.semester.create({
    data: {
      institutionId: institution.id,
      academicYearId: academicYear.id,
      code: `S1-${s}`,
      name: `Semester 1 ${code}`,
    },
  });

  const teacher = await testPrisma.teacher.create({
    data: {
      institutionId: institution.id,
      code: `T-${code}`,
      name: `Primary Teacher ${code}`,
    },
  });

  const substituteTeacher = await testPrisma.teacher.create({
    data: {
      institutionId: institution.id,
      code: `TS-${code}`,
      name: `Substitute Teacher ${code}`,
    },
  });

  const classRoom = await testPrisma.class.create({
    data: {
      institutionId: institution.id,
      code: `C-${code}`,
      name: `Class ${code}`,
      level: "XI",
    },
  });

  const subject = await testPrisma.subject.create({
    data: {
      institutionId: institution.id,
      code: `SUB-${code}`,
      name: `Subject ${code}`,
    },
  });

  const startPeriod = await testPrisma.schedulePeriod.create({
    data: {
      institutionId: institution.id,
      periodNumber: 1,
      startTime: time(7, 0),
      endTime: time(7, 40),
    },
  });

  await testPrisma.schedulePeriod.create({
    data: {
      institutionId: institution.id,
      periodNumber: 2,
      startTime: time(7, 40),
      endTime: time(8, 20),
    },
  });

  const schedule = await testPrisma.schedule.create({
    data: {
      institutionId: institution.id,
      academicYearId: academicYear.id,
      semesterId: semester.id,
      dayOfWeek: 5,
      primaryTeacherId: teacher.id,
      classId: classRoom.id,
      subjectId: subject.id,
      startPeriodNumber: startPeriod.periodNumber,
      endPeriodNumber: 2,
    },
  });

  await testPrisma.teacherSubstitution.create({
    data: {
      institutionId: institution.id,
      scheduleId: schedule.id,
      substitutionDate: SESSION_DATE,
      originalTeacherId: teacher.id,
      substituteTeacherId: substituteTeacher.id,
      startTime: time(7, 0),
      endTime: time(8, 20),
      reason: "Official substitution for lifecycle test",
      status: "APPROVED",
      approvedById: approver.id,
      approvedByInstitutionId: institution.id,
      approvedAt: new Date(
        "2026-09-24T12:00:00.000Z",
      ),
    },
  });

  return {
    institutionId: institution.id,
    scheduleId: schedule.id,
    teacherId: teacher.id,
    substituteTeacherId: substituteTeacher.id,
    approverUserId: approver.id,
    classId: classRoom.id,
    subjectId: subject.id,
    academicYearId: academicYear.id,
    semesterId: semester.id,
    sessionDate: SESSION_DATE,
    startPeriodNumber: 1,
    endPeriodNumber: 2,

    cleanup: async () => {
      await testPrisma.attendanceSessionSegment.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.attendanceSession.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.teacherSubstitution.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.schedule.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.schedulePeriod.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.subject.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.class.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.teacher.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.semester.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.academicYear.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.user.deleteMany({
        where: {
          institutionId: institution.id,
        },
      });

      await testPrisma.institution.delete({
        where: {
          id: institution.id,
        },
      });
    },
  };
}
