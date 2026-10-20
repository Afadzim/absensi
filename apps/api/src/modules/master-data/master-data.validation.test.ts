import { describe, expect, it } from "vitest";

import {
  MasterDataInputError,
  parseMasterDataInput,
} from "./master-data.validation.js";

describe("master data input validation", () => {
  it("requires scoped entity fields and rejects client-supplied tenant IDs", () => {
    expect(() =>
      parseMasterDataInput(
        "students",
        {
          institutionId: "11111111-1111-4111-8111-111111111111",
          code: "S-01",
          name: "Student",
        },
        "create",
      ),
    ).toThrowError(
      expect.objectContaining({ message: "Unknown field: institutionId" }),
    );
  });

  it("validates inclusive enrollment date ranges", () => {
    const studentId = "11111111-1111-4111-8111-111111111111";
    const classId = "22222222-2222-4222-8222-222222222222";
    const academicYearId = "33333333-3333-4333-8333-333333333333";

    expect(
      parseMasterDataInput(
        "student-enrollments",
        {
          studentId,
          classId,
          academicYearId,
          validFrom: "2026-09-01",
          validTo: "2026-09-30",
        },
        "create",
      ).data,
    ).toMatchObject({
      validFrom: new Date("2026-09-01T00:00:00.000Z"),
      validTo: new Date("2026-09-30T00:00:00.000Z"),
    });
  });

  it("rejects invalid and reversed date ranges", () => {
    expect(() =>
      parseMasterDataInput(
        "student-enrollments",
        {
          studentId: "11111111-1111-4111-8111-111111111111",
          classId: "22222222-2222-4222-8222-222222222222",
          academicYearId: "33333333-3333-4333-8333-333333333333",
          validFrom: "2026-02-30",
        },
        "create",
      ),
    ).toThrow(MasterDataInputError);

    expect(() =>
      parseMasterDataInput(
        "student-enrollments",
        {
          studentId: "11111111-1111-4111-8111-111111111111",
          classId: "22222222-2222-4222-8222-222222222222",
          academicYearId: "33333333-3333-4333-8333-333333333333",
          validFrom: "2026-09-30",
          validTo: "2026-09-01",
        },
        "create",
      ),
    ).toThrow(/validTo must be on or after validFrom/u);
  });

  it("does not trim passwords and enforces the authentication password policy", () => {
    const input = parseMasterDataInput(
      "users",
      {
        username: " operator ",
        password: "  valid password  ",
      },
      "create",
    );

    expect(input.data.username).toBe("operator");
    expect(input.data.password).toBe("  valid password  ");

    expect(() =>
      parseMasterDataInput(
        "users",
        { username: "operator", password: "short" },
        "create",
      ),
    ).toThrow(/password must contain/u);
  });

  it("supports clearing nullable values without clearing omitted fields", () => {
    expect(
      parseMasterDataInput(
        "teachers",
        { phone: null },
        "update",
      ).data,
    ).toEqual({ phone: null });
    expect(
      parseMasterDataInput("teachers", { name: "Updated" }, "update").data,
    ).toEqual({ name: "Updated" });
  });
});
