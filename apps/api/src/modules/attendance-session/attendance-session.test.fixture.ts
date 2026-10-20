import { testPrisma } from "../../test/db.js";

export type AttendanceSessionFixture = {
  institutionId: string;
  userId: string;
  sessionId: string;
  scheduleId: string;
  teacherId: string;
  classId: string;
  subjectId: string;
  academicYearId: string;
  semesterId: string;
  startPeriodNumber: number;
  endPeriodNumber: number;
  cleanup: () => Promise<void>;
};

const SESSION_DATE = new Date("2026-09-25T00:00:00.000Z");

function time(hour: number, minute: number): Date {
  return new Date(`1970-01-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
}

function suffix(): string {
  return `${Date.now().toString().slice(-8)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export async function createAttendanceSessionFixture(): Promise<AttendanceSessionFixture> {
  const s = suffix();
  const code = `AS-${s}`;

  const institution = await testPrisma.institution.create({
    data: {
      code: `INST-${code}`,
      name: `Attendance Session Test ${code}`,
    },
  });

  const user = await testPrisma.user.create({
    data: {
      institutionId: institution.id,
      username: `attendance-session-${s}`,
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
      name: `Teacher ${code}`,
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

  await testPrisma.scheduleClassParticipant.create({
    data: {
      institutionId: institution.id,
      scheduleId: schedule.id,
      classId: classRoom.id,
    },
  });

  const session = await testPrisma.attendanceSession.create({
    data: {
      institutionId: institution.id,
      scheduleId: schedule.id,
      sessionDate: SESSION_DATE,
      primaryTeacherIdSnapshot: teacher.id,
      primaryTeacherCodeSnapshot: teacher.code,
      primaryTeacherNameSnapshot: teacher.name,
      classIdSnapshot: classRoom.id,
      classCodeSnapshot: classRoom.code,
      classNameSnapshot: classRoom.name,
      subjectIdSnapshot: subject.id,
      subjectCodeSnapshot: subject.code,
      subjectNameSnapshot: subject.name,
      startPeriodNumberSnapshot: 1,
      endPeriodNumberSnapshot: 2,
      startTimeSnapshot: time(7, 0),
      endTimeSnapshot: time(8, 20),
      scheduledJpSnapshot: 2,
    },
  });

  return {
    institutionId: institution.id,
    userId: user.id,
    sessionId: session.id,
    scheduleId: schedule.id,
    teacherId: teacher.id,
    classId: classRoom.id,
    subjectId: subject.id,
    academicYearId: academicYear.id,
    semesterId: semester.id,
    startPeriodNumber: 1,
    endPeriodNumber: 2,
    cleanup: async () => {
      const hasAuditLogs = (await testPrisma.auditLog.count({
        where: { institutionId: institution.id },
      })) > 0;

      await testPrisma.studentAttendance.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.teacherAttendance.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.attendanceSessionSegment.deleteMany({
        where: { institutionId: institution.id },
      });

      await testPrisma.attendanceSession.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.scheduleClassParticipant.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.schedule.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.schedulePeriod.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.subject.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.class.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.teacher.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.semester.deleteMany({
        where: { institutionId: institution.id },
      });
      await testPrisma.academicYear.deleteMany({
        where: { institutionId: institution.id },
      });
      if (!hasAuditLogs) {
        await testPrisma.user.delete({
          where: { id: user.id },
        });
        await testPrisma.institution.delete({
          where: { id: institution.id },
        });
      }
    },
  };
}
