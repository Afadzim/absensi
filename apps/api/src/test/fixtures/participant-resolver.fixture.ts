import { randomUUID } from "node:crypto";

import {
  ScheduleStudentParticipantAction,
  StudentSubjectChoiceStatus,
  SubjectOfferingType,
} from "../../../generated/prisma/client.js";

import { testPrisma } from "../db.js";

export const TEST_DATE = new Date("2026-09-25T00:00:00.000Z");

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function uniqueCode(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function createParticipantResolverFixture() {
  const institution = await testPrisma.institution.create({
    data: {
      code: uniqueCode("TEST-INST"),
      name: "Institution Test Participant Resolver",
    },
  });

  const academicYear = await testPrisma.academicYear.create({
    data: {
      institutionId: institution.id,
      code: "2026-2027",
      name: "Tahun Pelajaran 2026/2027",
    },
  });

  const semester = await testPrisma.semester.create({
    data: {
      institutionId: institution.id,
      academicYearId: academicYear.id,
      code: "1",
      name: "Semester 1",
    },
  });

  const periodIds = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];

  const periods = await testPrisma.schedulePeriod.createManyAndReturn({
    data: [
      {
        id: periodIds[0],
        institutionId: institution.id,
        periodNumber: 1,
        startTime: new Date("1970-01-01T07:00:00.000Z"),
        endTime: new Date("1970-01-01T07:40:00.000Z"),
      },
      {
        id: periodIds[1],
        institutionId: institution.id,
        periodNumber: 2,
        startTime: new Date("1970-01-01T07:40:00.000Z"),
        endTime: new Date("1970-01-01T08:20:00.000Z"),
      },
      {
        id: periodIds[2],
        institutionId: institution.id,
        periodNumber: 3,
        startTime: new Date("1970-01-01T08:20:00.000Z"),
        endTime: new Date("1970-01-01T09:00:00.000Z"),
      },
      {
        id: periodIds[3],
        institutionId: institution.id,
        periodNumber: 4,
        startTime: new Date("1970-01-01T09:00:00.000Z"),
        endTime: new Date("1970-01-01T09:40:00.000Z"),
      },
    ],
  });

  const teacher = await testPrisma.teacher.create({
    data: {
      institutionId: institution.id,
      code: uniqueCode("GURU"),
      name: "Guru Test Participant Resolver",
    },
  });

  const classIds = {
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
  };

  const classes = await testPrisma.class.createManyAndReturn({
    data: [
      {
        id: classIds.a,
        institutionId: institution.id,
        code: uniqueCode("X-A"),
        name: "Kelas Test A",
        level: "X",
      },
      {
        id: classIds.b,
        institutionId: institution.id,
        code: uniqueCode("X-B"),
        name: "Kelas Test B",
        level: "X",
      },
      {
        id: classIds.c,
        institutionId: institution.id,
        code: uniqueCode("XI-A"),
        name: "Kelas Test C",
        level: "XI",
      },
    ],
  });

  const classA = classes.find((item) => item.id === classIds.a)!;
  const classB = classes.find((item) => item.id === classIds.b)!;
  const classC = classes.find((item) => item.id === classIds.c)!;

  const studentIds = {
    a1: randomUUID(),
    a2: randomUUID(),
    b1: randomUUID(),
    b2: randomUUID(),
    c1: randomUUID(),
  };

  const students = await testPrisma.student.createManyAndReturn({
    data: [
      {
        id: studentIds.a1,
        institutionId: institution.id,
        code: uniqueCode("S-A1"),
        name: "Student A1",
      },
      {
        id: studentIds.a2,
        institutionId: institution.id,
        code: uniqueCode("S-A2"),
        name: "Student A2",
      },
      {
        id: studentIds.b1,
        institutionId: institution.id,
        code: uniqueCode("S-B1"),
        name: "Student B1",
      },
      {
        id: studentIds.b2,
        institutionId: institution.id,
        code: uniqueCode("S-B2"),
        name: "Student B2",
      },
      {
        id: studentIds.c1,
        institutionId: institution.id,
        code: uniqueCode("S-C1"),
        name: "Student C1",
      },
    ],
  });

  const studentA1 = students.find((item) => item.id === studentIds.a1)!;
  const studentA2 = students.find((item) => item.id === studentIds.a2)!;
  const studentB1 = students.find((item) => item.id === studentIds.b1)!;
  const studentB2 = students.find((item) => item.id === studentIds.b2)!;
  const studentC1 = students.find((item) => item.id === studentIds.c1)!;

  await testPrisma.studentClassEnrollment.createMany({
    data: [
      {
        institutionId: institution.id,
        studentId: studentA1.id,
        classId: classA.id,
        academicYearId: academicYear.id,
        validFrom: TEST_DATE,
      },
      {
        institutionId: institution.id,
        studentId: studentA2.id,
        classId: classA.id,
        academicYearId: academicYear.id,
        validFrom: TEST_DATE,
      },
      {
        institutionId: institution.id,
        studentId: studentB1.id,
        classId: classB.id,
        academicYearId: academicYear.id,
        validFrom: TEST_DATE,
      },
      {
        institutionId: institution.id,
        studentId: studentB2.id,
        classId: classB.id,
        academicYearId: academicYear.id,
        validFrom: TEST_DATE,
      },
      {
        institutionId: institution.id,
        studentId: studentC1.id,
        classId: classC.id,
        academicYearId: academicYear.id,
        validFrom: TEST_DATE,
      },
    ],
  });

  const subjectIds = {
    regular: randomUUID(),
    grouping: randomUUID(),
    elective: randomUUID(),
  };

  const subjects = await testPrisma.subject.createManyAndReturn({
    data: [
      {
        id: subjectIds.regular,
        institutionId: institution.id,
        code: uniqueCode("SUB-REG"),
        name: "Mata Pelajaran Regular Test",
      },
      {
        id: subjectIds.grouping,
        institutionId: institution.id,
        code: uniqueCode("SUB-GRP"),
        name: "Mata Pelajaran Grouping Test",
      },
      {
        id: subjectIds.elective,
        institutionId: institution.id,
        code: uniqueCode("SUB-ELE"),
        name: "Mata Pelajaran Pilihan Test",
      },
    ],
  });

  const regularSubject = subjects.find(
    (item) => item.id === subjectIds.regular,
  )!;

  const groupingSubject = subjects.find(
    (item) => item.id === subjectIds.grouping,
  )!;

  const electiveSubject = subjects.find(
    (item) => item.id === subjectIds.elective,
  )!;

  const electiveOffering =
    await testPrisma.subjectOffering.create({
      data: {
        institutionId: institution.id,
        academicYearId: academicYear.id,
        subjectId: electiveSubject.id,
        offeringType: SubjectOfferingType.ELECTIVE,
        selectionStartLevel: "XI",
        continuationEndLevel: "XII",
      },
    });

  await testPrisma.studentSubjectChoice.createMany({
    data: [
      {
        institutionId: institution.id,
        studentId: studentA1.id,
        subjectOfferingId: electiveOffering.id,
        startLevel: "XI",
        status: StudentSubjectChoiceStatus.ACTIVE,
        effectiveFrom: TEST_DATE,
      },
      {
        institutionId: institution.id,
        studentId: studentB1.id,
        subjectOfferingId: electiveOffering.id,
        startLevel: "XI",
        status: StudentSubjectChoiceStatus.ACTIVE,
        effectiveFrom: TEST_DATE,
      },
    ],
  });

  const scheduleIds = {
    regular: randomUUID(),
    grouping: randomUUID(),
    elective: randomUUID(),
  };

  const schedules = await testPrisma.schedule.createManyAndReturn({
    data: [
      {
        id: scheduleIds.regular,
        institutionId: institution.id,
        academicYearId: academicYear.id,
        semesterId: semester.id,
        dayOfWeek: 5,
        primaryTeacherId: teacher.id,
        classId: classA.id,
        subjectId: regularSubject.id,
        startPeriodNumber: 1,
        endPeriodNumber: 2,
      },
      {
        id: scheduleIds.grouping,
        institutionId: institution.id,
        academicYearId: academicYear.id,
        semesterId: semester.id,
        dayOfWeek: 5,
        primaryTeacherId: teacher.id,
        classId: classA.id,
        subjectId: groupingSubject.id,
        startPeriodNumber: 3,
        endPeriodNumber: 4,
      },
      {
        id: scheduleIds.elective,
        institutionId: institution.id,
        academicYearId: academicYear.id,
        semesterId: semester.id,
        dayOfWeek: 5,
        primaryTeacherId: teacher.id,
        classId: classC.id,
        subjectId: electiveSubject.id,
        subjectOfferingId: electiveOffering.id,
        subjectOfferingInstitutionId: institution.id,
        startPeriodNumber: 1,
        endPeriodNumber: 2,
      },
    ],
  });

  const regularSchedule = schedules.find(
    (item) => item.id === scheduleIds.regular,
  )!;

  const groupingSchedule = schedules.find(
    (item) => item.id === scheduleIds.grouping,
  )!;

  const electiveSchedule = schedules.find(
    (item) => item.id === scheduleIds.elective,
  )!;

  await testPrisma.scheduleClassParticipant.createMany({
    data: [
      {
        institutionId: institution.id,
        scheduleId: regularSchedule.id,
        classId: classA.id,
      },
      {
        institutionId: institution.id,
        scheduleId: groupingSchedule.id,
        classId: classA.id,
      },
      {
        institutionId: institution.id,
        scheduleId: groupingSchedule.id,
        classId: classB.id,
      },
    ],
  });

  const overrideUser = await testPrisma.user.create({
    data: {
      institutionId: institution.id,
      username: uniqueCode("fixture-user"),
      passwordHash: "fixture-password-hash",
    },
  });

  return {
    institution,
    academicYear,
    semester,
    periods,

    teacher,

    classes: {
      a: classA,
      b: classB,
      c: classC,
    },

    students: {
      a1: studentA1,
      a2: studentA2,
      b1: studentB1,
      b2: studentB2,
      c1: studentC1,
    },

    subjects: {
      regular: regularSubject,
      grouping: groupingSubject,
      elective: electiveSubject,
    },

    electiveOffering,

    schedules: {
      regular: regularSchedule,
      grouping: groupingSchedule,
      elective: electiveSchedule,
    },

    overrideUser,

    dates: {
      testDate: TEST_DATE,
      beforeTestDate: addDays(TEST_DATE, -1),
      afterTestDate: addDays(TEST_DATE, 1),
    },
  };
}

export async function addScheduleStudentOverride(input: {
  institutionId: string;
  scheduleId: string;
  studentId: string;
  createdByUserId: string;
  action: ScheduleStudentParticipantAction;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  reason?: string;
}) {
  return testPrisma.scheduleStudentParticipant.create({
    data: {
      institutionId: input.institutionId,
      scheduleId: input.scheduleId,
      studentId: input.studentId,
      action: input.action,
      effectiveFrom: input.effectiveFrom ?? TEST_DATE,
      effectiveTo: input.effectiveTo,
      reason: input.reason ?? `Fixture ${input.action}`,
      createdByUserId: input.createdByUserId,
    },
  });
}

export async function addConflictingEnrollment(input: {
  institutionId: string;
  studentId: string;
  classId: string;
  academicYearId: string;
  validFrom?: Date;
  validTo?: Date;
}) {
  return testPrisma.studentClassEnrollment.create({
    data: {
      institutionId: input.institutionId,
      studentId: input.studentId,
      classId: input.classId,
      academicYearId: input.academicYearId,
      validFrom: input.validFrom ?? TEST_DATE,
      validTo: input.validTo,
    },
  });
}

export async function addOverlappingOverride(input: {
  institutionId: string;
  scheduleId: string;
  studentId: string;
  createdByUserId: string;
  firstAction: ScheduleStudentParticipantAction;
  secondAction: ScheduleStudentParticipantAction;
}) {
  await addScheduleStudentOverride({
    institutionId: input.institutionId,
    scheduleId: input.scheduleId,
    studentId: input.studentId,
    createdByUserId: input.createdByUserId,
    action: input.firstAction,
    effectiveFrom: TEST_DATE,
    effectiveTo: addDays(TEST_DATE, 10),
  });

  return addScheduleStudentOverride({
    institutionId: input.institutionId,
    scheduleId: input.scheduleId,
    studentId: input.studentId,
    createdByUserId: input.createdByUserId,
    action: input.secondAction,
    effectiveFrom: addDays(TEST_DATE, 2),
    effectiveTo: addDays(TEST_DATE, 8),
  });
}
