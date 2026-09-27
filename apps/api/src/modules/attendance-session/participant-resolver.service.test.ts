import { afterAll, describe, expect, it } from "vitest";

import {
  ScheduleStudentParticipantAction,
} from "../../../generated/prisma/client.js";

import { ParticipantResolverService } from "./participant-resolver.service.js";

import {
  TEST_DATE,
  addConflictingEnrollment,
  addOverlappingOverride,
  addScheduleStudentOverride,
  createParticipantResolverFixture,
} from "../../test/fixtures/participant-resolver.fixture.js";

import {
  closeTestDb,
  testPrisma,
} from "../../test/db.js";

const SESSION_DATE = "2026-09-25";

describe("ParticipantResolverService", () => {
  const resolver = new ParticipantResolverService();
afterAll(async () => {
    await closeTestDb();
  });

  it("REGULAR: mengembalikan seluruh siswa dari satu kelas", async () => {
    const fixture = await createParticipantResolverFixture();

    const result = await resolver.resolve({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.regular.id,
      sessionDate: SESSION_DATE,
    });

    expect(result).toHaveLength(2);

    expect(result.map((item) => item.studentId).sort()).toEqual(
      [
        fixture.students.a1.id,
        fixture.students.a2.id,
      ].sort(),
    );
  });

  it("GROUPING: mengembalikan seluruh siswa dari seluruh kelas peserta", async () => {
    const fixture = await createParticipantResolverFixture();

    const result = await resolver.resolve({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.grouping.id,
      sessionDate: SESSION_DATE,
    });

    expect(result).toHaveLength(4);

    expect(result.map((item) => item.studentId).sort()).toEqual(
      [
        fixture.students.a1.id,
        fixture.students.a2.id,
        fixture.students.b1.id,
        fixture.students.b2.id,
      ].sort(),
    );
  });

  it("ELECTIVE: hanya mengembalikan siswa dengan StudentSubjectChoice aktif", async () => {
    const fixture = await createParticipantResolverFixture();

    const result = await resolver.resolve({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      sessionDate: SESSION_DATE,
    });

    expect(result).toHaveLength(2);

    expect(result.map((item) => item.studentId).sort()).toEqual(
      [
        fixture.students.a1.id,
        fixture.students.b1.id,
      ].sort(),
    );
  });

  it("ELECTIVE + INCLUDE: INCLUDE menambahkan siswa ke roster", async () => {
    const fixture = await createParticipantResolverFixture();

    await addScheduleStudentOverride({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      studentId: fixture.students.c1.id,
      createdByUserId: fixture.overrideUser.id,
      action: ScheduleStudentParticipantAction.INCLUDE,
    });

    const result = await resolver.resolve({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      sessionDate: SESSION_DATE,
    });

    expect(result).toHaveLength(3);

    expect(result.map((item) => item.studentId).sort()).toEqual(
      [
        fixture.students.a1.id,
        fixture.students.b1.id,
        fixture.students.c1.id,
      ].sort(),
    );
  });

  it("ELECTIVE + EXCLUDE: EXCLUDE mengeluarkan siswa dari roster", async () => {
    const fixture = await createParticipantResolverFixture();

    await addScheduleStudentOverride({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      studentId: fixture.students.a1.id,
      createdByUserId: fixture.overrideUser.id,
      action: ScheduleStudentParticipantAction.EXCLUDE,
    });

    const result = await resolver.resolve({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      sessionDate: SESSION_DATE,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.studentId).toBe(fixture.students.b1.id);
  });

  it("override effective date: override di luar tanggal tidak berlaku", async () => {
    const fixture = await createParticipantResolverFixture();

    await addScheduleStudentOverride({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      studentId: fixture.students.c1.id,
      createdByUserId: fixture.overrideUser.id,
      action: ScheduleStudentParticipantAction.INCLUDE,
      effectiveFrom: fixture.dates.afterTestDate,
    });

    const result = await resolver.resolve({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      sessionDate: SESSION_DATE,
    });

    expect(result).toHaveLength(2);

    expect(result.map((item) => item.studentId).sort()).toEqual(
      [
        fixture.students.a1.id,
        fixture.students.b1.id,
      ].sort(),
    );
  });

  it("conflicting StudentClassEnrollment: resolver harus reject", async () => {
    const fixture = await createParticipantResolverFixture();

    await addConflictingEnrollment({
      institutionId: fixture.institution.id,
      studentId: fixture.students.a1.id,
      classId: fixture.classes.b.id,
      academicYearId: fixture.academicYear.id,
    });

    await expect(
      resolver.resolve({
        institutionId: fixture.institution.id,
        scheduleId: fixture.schedules.elective.id,
        sessionDate: SESSION_DATE,
      }),
    ).rejects.toThrow(
      /multiple active class enrollments/i,
    );
  });

  it("conflicting active override: resolver harus reject", async () => {
    const fixture = await createParticipantResolverFixture();

    await addOverlappingOverride({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      studentId: fixture.students.a1.id,
      createdByUserId: fixture.overrideUser.id,
      firstAction: ScheduleStudentParticipantAction.EXCLUDE,
      secondAction: ScheduleStudentParticipantAction.INCLUDE,
    });

    await expect(
      resolver.resolve({
        institutionId: fixture.institution.id,
        scheduleId: fixture.schedules.elective.id,
        sessionDate: "2026-09-27",
      }),
    ).rejects.toThrow(
      /multiple active.*override/i,
    );
  });

  it("TENANT ISOLATION: schedule institution A tidak boleh di-resolve oleh institution B", async () => {
    const fixtureA = await createParticipantResolverFixture();
    const fixtureB = await createParticipantResolverFixture();

    await expect(
      resolver.resolve({
        institutionId: fixtureB.institution.id,
        scheduleId: fixtureA.schedules.regular.id,
        sessionDate: SESSION_DATE,
      }),
    ).rejects.toThrow(
      /Schedule not found/i,
    );
  });

  it("INCLUDE tanpa enrollment aktif: resolver harus reject", async () => {
    const fixture = await createParticipantResolverFixture();

    const studentWithoutEnrollment =
      await testPrisma.student.create({
        data: {
          institutionId: fixture.institution.id,
          code: "S-NO-ENROLLMENT",
          name: "Student Without Enrollment",
        },
      });

    await addScheduleStudentOverride({
      institutionId: fixture.institution.id,
      scheduleId: fixture.schedules.elective.id,
      studentId: studentWithoutEnrollment.id,
      createdByUserId: fixture.overrideUser.id,
      action: ScheduleStudentParticipantAction.INCLUDE,
    });

    await expect(
      resolver.resolve({
        institutionId: fixture.institution.id,
        scheduleId: fixture.schedules.elective.id,
        sessionDate: SESSION_DATE,
      }),
    ).rejects.toThrow(
      /no active class enrollment/i,
    );
  });


});


