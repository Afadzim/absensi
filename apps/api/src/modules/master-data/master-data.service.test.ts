import { afterAll, describe, expect, it } from "vitest";

import { closeTestDb, testPrisma } from "../../test/db.js";
import { MasterDataConflictError, MasterDataService } from "./master-data.service.js";

function suffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

describe("MasterDataService", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("creates and updates tenant-scoped master records with audit", async () => {
    const service = new MasterDataService();
    const key = suffix();
    const institution = await testPrisma.institution.create({
      data: { code: `MD-${key}`, name: `Master data ${key}` },
    });
    const otherInstitution = await testPrisma.institution.create({
      data: { code: `MD-OTHER-${key}`, name: `Other institution ${key}` },
    });
    const actor = await testPrisma.user.create({
      data: {
        institutionId: institution.id,
        username: `owner-${key}`,
        passwordHash: "test-owner-password-hash",
      },
    });
    const role = await testPrisma.role.create({
      data: { name: `MD_ROLE_${key}` },
    });
    const auth = {
      sessionId: "session-test",
      userId: actor.id,
      institutionId: institution.id,
      teacherId: null,
      roles: [],
      permissions: [],
    };
    const auditContext = {
      auth,
      requestId: `test-${key}`,
      ipAddress: "127.0.0.1",
      userAgent: "vitest-master-data",
    };
    const academicYear = await service.create(
      "academic-years",
      auditContext,
      { code: `AY-${key}`, name: "Academic year" },
    ) as { id: string };
    const semester = await service.create(
      "semesters",
      auditContext,
      {
        academicYearId: academicYear.id,
        code: "S1",
        name: "Semester 1",
      },
    ) as { id: string };
    const teacher = await service.create(
      "teachers",
      auditContext,
      { code: `T-${key}`, name: "Teacher", phone: null },
    ) as { id: string };
    const student = await service.create(
      "students",
      auditContext,
      { code: `ST-${key}`, name: "Student", nisn: null },
    ) as { id: string };
    const classRecord = await service.create(
      "classes",
      auditContext,
      { code: `C-${key}`, name: "Class", level: "X" },
    ) as { id: string };
    const subject = await service.create(
      "subjects",
      auditContext,
      { code: `SUB-${key}`, name: "Subject" },
    ) as { id: string };
    const room = await service.create(
      "rooms",
      auditContext,
      { code: `R-${key}`, name: "Room" },
    ) as { id: string };
    const period = await service.create(
      "schedule-periods",
      auditContext,
      {
        periodNumber: 1,
        startTime: "07:00",
        endTime: "07:40",
      },
    );
    expect(period).toMatchObject({ periodNumber: 1 });

    const offering = await service.create(
      "subject-offerings",
      auditContext,
      {
        academicYearId: academicYear.id,
        subjectId: subject.id,
        offeringType: "ELECTIVE",
        selectionStartLevel: "XI",
        continuationEndLevel: "XII",
      },
    ) as { id: string };
    const subjectChoice = await service.create(
      "student-subject-choices",
      auditContext,
      {
        studentId: student.id,
        subjectOfferingId: offering.id,
        startLevel: "XI",
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        reason: "Pilihan siswa",
        auditReason: "Pencatatan awal",
      },
    ) as { id: string };
    expect(subjectChoice.id).toBeTruthy();

    const enrollment = await service.create(
      "student-enrollments",
      auditContext,
      {
        studentId: student.id,
        classId: classRecord.id,
        academicYearId: academicYear.id,
        validFrom: "2026-09-01",
        validTo: "2026-09-10",
      },
    ) as { id: string };
    await expect(
      service.create("student-enrollments", auditContext, {
        studentId: student.id,
        classId: classRecord.id,
        academicYearId: academicYear.id,
        validFrom: "2026-09-10",
        validTo: null,
      }),
    ).rejects.toBeInstanceOf(MasterDataConflictError);

    const adjacentEnrollment = await service.create(
      "student-enrollments",
      auditContext,
      {
        studentId: student.id,
        classId: classRecord.id,
        academicYearId: academicYear.id,
        validFrom: "2026-09-11",
        validTo: null,
      },
    ) as { id: string };
    expect(adjacentEnrollment.id).not.toBe(enrollment.id);

    await expect(
      service.get("academic-years", otherInstitution.id, academicYear.id),
    ).resolves.toBeNull();

    const user = await service.create(
      "users",
      auditContext,
      {
        username: `teacher-${key}`,
        password: "Teacher password 123",
        roleIds: [role.id],
        teacherId: teacher.id,
      },
    ) as {
      id: string;
      roles: Array<{ id: string }>;
      teacher: { id: string } | null;
      passwordHash?: string;
    };
    expect(user.roles.map((item) => item.id)).toContain(role.id);
    expect(user.teacher?.id).toBe(teacher.id);
    expect(user).not.toHaveProperty("passwordHash");

    const linkedTeacher = await testPrisma.teacher.findUniqueOrThrow({
      where: { id: teacher.id },
    });
    expect(linkedTeacher.userId).toBe(user.id);
    const accountAudit = await testPrisma.auditLog.findFirstOrThrow({
      where: {
        institutionId: institution.id,
        entity: "User",
        entityId: user.id,
        action: "CREATE",
      },
    });
    expect(accountAudit.afterData).not.toHaveProperty("passwordHash");

    await service.update("users", auditContext, user.id, {
      roleIds: [],
      teacherId: null,
      auditReason: "Melepas akses akun",
    });
    const unlinkedTeacher = await testPrisma.teacher.findUniqueOrThrow({
      where: { id: teacher.id },
    });
    expect(unlinkedTeacher.userId).toBeNull();
    expect(
      await testPrisma.userRole.count({ where: { userId: user.id } }),
    ).toBe(0);

    const updatedStudent = await service.update(
      "students",
      auditContext,
      student.id,
      { name: "Updated Student", auditReason: "Koreksi data" },
    ) as { name: string };
    expect(updatedStudent.name).toBe("Updated Student");

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: {
        institutionId: institution.id,
        entity: "Student",
        entityId: student.id,
        action: "UPDATE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actorUserId).toBe(actor.id);
    expect(audit.beforeData).toMatchObject({ name: "Student" });
    expect(audit.afterData).toMatchObject({ name: "Updated Student" });
    expect(audit.reason).toBe("Koreksi data");

    const list = await service.list("semesters", institution.id, {
      page: 1,
      pageSize: 10,
    });
    expect(list.total).toBe(1);
    expect(list.data).toHaveLength(1);
    expect(semester.id).toBeTruthy();
    expect(room.id).toBeTruthy();
  });

  it("enforces enrollment overlap in PostgreSQL outside the API service", async () => {
    const key = suffix();
    const institution = await testPrisma.institution.create({
      data: { code: `MD-DB-${key}`, name: `Enrollment DB ${key}` },
    });
    const academicYear = await testPrisma.academicYear.create({
      data: {
        institutionId: institution.id,
        code: `AY-${key}`,
        name: "Academic year",
      },
    });
    const student = await testPrisma.student.create({
      data: {
        institutionId: institution.id,
        code: `ST-${key}`,
        name: "Student",
      },
    });
    const firstClass = await testPrisma.class.create({
      data: {
        institutionId: institution.id,
        code: `C1-${key}`,
        name: "Class 1",
      },
    });
    const secondClass = await testPrisma.class.create({
      data: {
        institutionId: institution.id,
        code: `C2-${key}`,
        name: "Class 2",
      },
    });
    await testPrisma.studentClassEnrollment.create({
      data: {
        institutionId: institution.id,
        studentId: student.id,
        classId: firstClass.id,
        academicYearId: academicYear.id,
        validFrom: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    await expect(
      testPrisma.studentClassEnrollment.create({
        data: {
          institutionId: institution.id,
          studentId: student.id,
          classId: secondClass.id,
          academicYearId: academicYear.id,
          validFrom: new Date("2026-09-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();

    const concurrentStudent = await testPrisma.student.create({
      data: {
        institutionId: institution.id,
        code: `ST-CONCURRENT-${key}`,
        name: "Concurrent Student",
      },
    });
    const service = new MasterDataService();
    const authUser = await testPrisma.user.create({
      data: {
        institutionId: institution.id,
        username: `owner-concurrent-${key}`,
        passwordHash: "test-owner-password-hash",
      },
    });
    const context = {
      auth: {
        sessionId: "concurrent-session",
        userId: authUser.id,
        institutionId: institution.id,
        teacherId: null,
        roles: [],
        permissions: [],
      },
      requestId: `concurrent-${key}`,
      ipAddress: "127.0.0.1",
    };
    const attempts = await Promise.allSettled([
      service.create("student-enrollments", context, {
        studentId: concurrentStudent.id,
        classId: firstClass.id,
        academicYearId: academicYear.id,
        validFrom: "2026-09-01",
        validTo: null,
      }),
      service.create("student-enrollments", context, {
        studentId: concurrentStudent.id,
        classId: secondClass.id,
        academicYearId: academicYear.id,
        validFrom: "2026-09-01",
        validTo: null,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });
});
