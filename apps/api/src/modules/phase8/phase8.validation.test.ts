import { afterEach, describe, expect, it } from "vitest";
import {
  parseCalendarDayInput,
  parseReportRange,
  Phase8InputError,
  systemEffectiveDate,
} from "./phase8.validation.js";
import {
  attendancePercentage,
  teacherPercentage,
} from "./phase8.service.js";

describe("Phase 8 report and calendar validation", () => {
  afterEach(() => {
    delete process.env.SYSTEM_EFFECTIVE_DATE;
  });

  it("accepts strict date-only calendar entries and rejects unknown fields", () => {
    expect(
      parseCalendarDayInput(
        {
          calendarDate: "2026-07-15",
          dayType: "EFFECTIVE",
          label: "Hari efektif",
        },
        "create",
      ).data.calendarDate?.toISOString(),
    ).toBe("2026-07-15T00:00:00.000Z");
    expect(() =>
      parseCalendarDayInput(
        { calendarDate: "2026-02-30", dayType: "EFFECTIVE" },
        "create",
      ),
    ).toThrow(Phase8InputError);
    expect(() =>
      parseCalendarDayInput(
        { calendarDate: "2026-07-15", dayType: "EFFECTIVE", institutionId: "x" },
        "create",
      ),
    ).toThrow(/Unknown field/u);
  });

  it("validates the official cutoff and maximum inclusive report range", () => {
    const cutoff = new Date("2026-07-15T00:00:00.000Z");
    expect(
      parseReportRange("2026-07-15", "2026-07-15", cutoff).startDate,
    ).toEqual(cutoff);
    expect(() =>
      parseReportRange("2026-07-14", "2026-07-15", cutoff),
    ).toThrow(/Official reports start/u);
    expect(() =>
      parseReportRange("2026-07-15", "2027-07-16", cutoff),
    ).toThrow(/cannot exceed 366 days/u);
    process.env.SYSTEM_EFFECTIVE_DATE = "";
    expect(() => systemEffectiveDate()).toThrow(/must be configured/u);
  });

  it("uses the approved attendance numerators and total denominators", () => {
    expect(
      attendancePercentage(
        { HADIR: 30, PENUGASAN: 2, IZIN: 3, SAKIT: 1, ALPA: 4 },
        40,
      ),
    ).toBe(80);
    expect(
      teacherPercentage({ HADIR: 34, DINAS: 3, IZIN: 1, SAKIT: 1, ALPA: 1 }, 40),
    ).toBe(92.5);
    expect(attendancePercentage({}, 0)).toBeNull();
    expect(teacherPercentage({}, 0)).toBeNull();
  });
});
