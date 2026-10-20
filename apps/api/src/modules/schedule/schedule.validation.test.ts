import { describe, expect, it } from "vitest";
import {
  parseScheduleInput,
  parseScheduleStudentParticipantInput,
  getIsoWeekday,
  ScheduleInputError,
} from "./schedule.validation.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("schedule input validation", () => {
  it("maps UTC dates to ISO weekdays (Monday=1, Sunday=7)", () => {
    expect(getIsoWeekday(new Date("2026-10-19T00:00:00.000Z"))).toBe(1);
    expect(getIsoWeekday(new Date("2026-10-25T00:00:00.000Z"))).toBe(7);
  });

  it("accepts an ISO weekday and inclusive contiguous period range", () => {
    expect(
      parseScheduleInput(
        {
          academicYearId: UUID_A,
          semesterId: UUID_B,
          dayOfWeek: 7,
          primaryTeacherId: UUID_A,
          classId: UUID_B,
          subjectId: UUID_A,
          startPeriodNumber: 1,
          endPeriodNumber: 3,
          classParticipantIds: [UUID_B],
        },
        "create",
      ).data,
    ).toMatchObject({
      dayOfWeek: 7,
      startPeriodNumber: 1,
      endPeriodNumber: 3,
      classParticipantIds: [UUID_B],
    });
  });

  it("rejects invalid weekdays, reversed ranges, and unknown tenant fields", () => {
    expect(() =>
      parseScheduleInput(
        {
          academicYearId: UUID_A,
          semesterId: UUID_B,
          dayOfWeek: 8,
          primaryTeacherId: UUID_A,
          classId: UUID_B,
          subjectId: UUID_A,
          startPeriodNumber: 1,
          endPeriodNumber: 1,
        },
        "create",
      ),
    ).toThrow(ScheduleInputError);
    expect(() =>
      parseScheduleInput(
        { startPeriodNumber: 3, endPeriodNumber: 2 },
        "update",
      ),
    ).toThrow(/endPeriodNumber must be on or after/u);
    expect(() =>
      parseScheduleInput({ institutionId: UUID_A }, "update"),
    ).toThrow(/Unknown field: institutionId/u);
  });

  it("validates inclusive date ranges for student participant overrides", () => {
    expect(
      parseScheduleStudentParticipantInput(
        {
          studentId: UUID_A,
          action: "INCLUDE",
          effectiveFrom: "2026-09-01",
          effectiveTo: "2026-09-30",
        },
        "create",
      ).data,
    ).toMatchObject({
      studentId: UUID_A,
      action: "INCLUDE",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-09-30T00:00:00.000Z"),
    });

    expect(() =>
      parseScheduleStudentParticipantInput(
        {
          studentId: UUID_A,
          action: "EXCLUDE",
          effectiveFrom: "2026-09-30",
          effectiveTo: "2026-09-01",
        },
        "create",
      ),
    ).toThrow(/effectiveTo must be on or after/u);
  });
});
