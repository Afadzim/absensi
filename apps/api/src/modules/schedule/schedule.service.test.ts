import { afterAll, describe, expect, it } from "vitest";
import { closeTestDb, testPrisma } from "../../test/db.js";
import {
  ScheduleConflictError,
  ScheduleService,
} from "./schedule.service.js";

function suffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createFixture() {
  const key = suffix();
  const institution = await testPrisma.institution.create({
    data: { code: `SCH-${key}`, name: `Schedule ${key}` },
  });
  const actor = await testPrisma.user.create({
    data: {
      institutionId: institution.id,
      username: `schedule-${key}`,
      passwordHash: "test-password-hash",
    },
  });
  const academicYear = await testPrisma.academicYear.create({
    data: {
      institutionId: institution.id,
      code: `AY-${key}`,
      name: "Academic year",
    },
  });
  const semester = await testPrisma.semester.create({
    data: {
      institutionId: institution.id,
      academicYearId: academicYear.id,
      code: `S-${key}`,
      name: "Semester",
    },
  });
  const teachers = await Promise.all(
    ["A", "B", "C"].map((code) =>
      testPrisma.teacher.create({
        data: {
          institutionId: institution.id,
          code: `T-${code}-${key}`,
          name: `Teacher ${code}`,
        },
      }),
    ),
  );
  const classes = await Promise.all(
    ["A", "B", "C"].map((code) =>
      testPrisma.class.create({
        data: {
          institutionId: institution.id,
          code: `C-${code}-${key}`,
          name: `Class ${code}`,
        },
      }),
    ),
  );
  const subject = await testPrisma.subject.create({
    data: {
      institutionId: institution.id,
      code: `SUB-${key}`,
      name: "Subject",
    },
  });
  const rooms = await Promise.all(
    ["A", "B"].map((code) =>
      testPrisma.room.create({
        data: {
          institutionId: institution.id,
          code: `R-${code}-${key}`,
          name: `Room ${code}`,
        },
      }),
    ),
  );
  await testPrisma.schedulePeriod.createMany({
    data: [1, 2, 3].map((periodNumber) => ({
      institutionId: institution.id,
      periodNumber,
      startTime: new Date(`1970-01-01T${String(6 + periodNumber).padStart(2, "0")}:00:00.000Z`),
      endTime: new Date(`1970-01-01T${String(6 + periodNumber).padStart(2, "0")}:40:00.000Z`),
    })),
  });
  const student = await testPrisma.student.create({
    data: {
      institutionId: institution.id,
      code: `ST-${key}`,
      name: "Student",
    },
  });
  const context = {
    auth: {
      sessionId: "schedule-test",
      userId: actor.id,
      institutionId: institution.id,
      teacherId: null,
      roles: [],
      permissions: [],
    },
    requestId: `schedule-${key}`,
    ipAddress: "127.0.0.1",
    userAgent: "vitest-schedule",
  };
  return {
    context,
    institution,
    academicYear,
    semester,
    teachers,
    classes,
    subject,
    rooms,
    student,
  };
}

function scheduleInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  values: {
    teacher?: number;
    classRecord?: number;
    room?: number;
    dayOfWeek?: number;
    startPeriodNumber?: number;
    endPeriodNumber?: number;
    classParticipantIds?: string[];
  } = {},
) {
  return {
    academicYearId: fixture.academicYear.id,
    semesterId: fixture.semester.id,
    dayOfWeek: values.dayOfWeek ?? 1,
    primaryTeacherId: fixture.teachers[values.teacher ?? 0].id,
    classId: fixture.classes[values.classRecord ?? 0].id,
    subjectId: fixture.subject.id,
    roomId: fixture.rooms[values.room ?? 0].id,
    startPeriodNumber: values.startPeriodNumber ?? 1,
    endPeriodNumber: values.endPeriodNumber ?? 2,
    classParticipantIds: values.classParticipantIds ?? [],
  };
}

describe("ScheduleService", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("creates tenant-scoped schedules, audits changes, and rejects resource conflicts", async () => {
    const service = new ScheduleService();
    const fixture = await createFixture();
    const schedule = await service.create(
      fixture.context,
      scheduleInput(fixture, {
        classParticipantIds: [fixture.classes[1].id],
      }),
    );
    expect(schedule.classParticipants.map(({ classId }) => classId).sort()).toEqual(
      [fixture.classes[0].id, fixture.classes[1].id].sort(),
    );

    const update = await service.update(
      fixture.context,
      schedule.id,
      { roomId: fixture.rooms[1].id, auditReason: "Perubahan ruang" },
    );
    expect(update).toMatchObject({ roomId: fixture.rooms[1].id });
    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: {
        institutionId: fixture.institution.id,
        entity: "Schedule",
        entityId: schedule.id,
        action: "UPDATE",
      },
    });
    expect(audit.actorUserId).toBe(fixture.context.auth.userId);
    expect(audit.reason).toBe("Perubahan ruang");
    expect(audit.beforeData).toMatchObject({ roomId: fixture.rooms[0].id });
    expect(audit.afterData).toMatchObject({ roomId: fixture.rooms[1].id });

    await expect(
      service.create(fixture.context, scheduleInput(fixture, { teacher: 0, classRecord: 2, room: 0 })),
    ).rejects.toBeInstanceOf(ScheduleConflictError);
    await expect(
      service.create(fixture.context, scheduleInput(fixture, { teacher: 1, classRecord: 1, room: 0 })),
    ).rejects.toBeInstanceOf(ScheduleConflictError);
    await expect(
      service.create(fixture.context, scheduleInput(fixture, { teacher: 1, classRecord: 2, room: 1 })),
    ).rejects.toBeInstanceOf(ScheduleConflictError);

    const adjacent = await service.create(
      fixture.context,
      scheduleInput(fixture, {
        teacher: 0,
        classRecord: 2,
        room: 0,
        startPeriodNumber: 3,
        endPeriodNumber: 3,
      }),
    );
    expect(adjacent.id).not.toBe(schedule.id);
    await expect(
      service.create(
        fixture.context,
        scheduleInput(fixture, {
          teacher: 1,
          classRecord: 2,
          room: 1,
          startPeriodNumber: 1,
          endPeriodNumber: 4,
        }),
      ),
    ).rejects.toThrow(/Every schedule period/u);

    const otherTenant = await testPrisma.institution.create({
      data: {
        code: `SCH-OTHER-${suffix()}`,
        name: "Other schedule institution",
      },
    });
    await expect(
      service.get(otherTenant.id, schedule.id),
    ).resolves.toBeNull();
  });

  it("manages dated student overrides and rejects overlapping periods", async () => {
    const service = new ScheduleService();
    const fixture = await createFixture();
    const schedule = await service.create(
      fixture.context,
      scheduleInput(fixture),
    );
    const first = await service.createStudentParticipant(
      fixture.context,
      schedule.id,
      {
        studentId: fixture.student.id,
        action: "INCLUDE",
        effectiveFrom: "2026-09-01",
        effectiveTo: "2026-09-10",
        reason: "Pengecualian roster",
      },
    );
    expect(first.action).toBe("INCLUDE");
    await expect(
      service.createStudentParticipant(fixture.context, schedule.id, {
        studentId: fixture.student.id,
        action: "EXCLUDE",
        effectiveFrom: "2026-09-10",
        effectiveTo: null,
      }),
    ).rejects.toBeInstanceOf(ScheduleConflictError);
    const adjacent = await service.createStudentParticipant(
      fixture.context,
      schedule.id,
      {
        studentId: fixture.student.id,
        action: "EXCLUDE",
        effectiveFrom: "2026-09-11",
        effectiveTo: null,
      },
    );
    expect(adjacent.action).toBe("EXCLUDE");
  });
});
