import { AUTH_CONSTANTS } from "../auth/auth.constants.js";

export const MASTER_DATA_RESOURCES = [
  "institutions",
  "academic-years",
  "semesters",
  "teachers",
  "students",
  "classes",
  "student-enrollments",
  "subjects",
  "rooms",
  "schedule-periods",
  "subject-offerings",
  "student-subject-choices",
  "users",
] as const;

export type MasterDataResource = (typeof MASTER_DATA_RESOURCES)[number];
export type MasterDataOperation = "read" | "create" | "update";
export type MasterDataInput = Record<
  string,
  string | number | Date | null | string[]
>;

export class MasterDataInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterDataInputError";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new MasterDataInputError("Request body must be an object.");
  }

  return value as Record<string, unknown>;
}

function assertFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknownFields = Object.keys(body).filter(
    (field) => !allowed.includes(field),
  );

  if (unknownFields.length > 0) {
    throw new MasterDataInputError(
      `Unknown field: ${unknownFields.join(", ")}`,
    );
  }
}

function text(
  body: Record<string, unknown>,
  field: string,
  maximum: number,
  required: boolean,
): string | undefined {
  const value = body[field];

  if (value === undefined && !required) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new MasterDataInputError(`${field} must be a string.`);
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maximum) {
    throw new MasterDataInputError(
      `${field} must contain between 1 and ${maximum} characters.`,
    );
  }

  return normalized;
}

function uuid(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): string | undefined {
  const value = body[field];

  if (value === undefined && !required) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new MasterDataInputError(`${field} must be a valid UUID.`);
  }

  return value;
}

function date(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): Date | null | undefined {
  const value = body[field];

  if (value === undefined && !required) {
    return undefined;
  }

  if (value === null && !required) {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new MasterDataInputError(`${field} must be a YYYY-MM-DD date.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new MasterDataInputError(`${field} must be a valid calendar date.`);
  }

  return parsed;
}

function time(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): Date | undefined {
  const value = body[field];

  if (value === undefined && !required) {
    return undefined;
  }

  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new MasterDataInputError(`${field} must use HH:mm format.`);
  }

  return new Date(`1970-01-01T${value}:00.000Z`);
}

function positiveInteger(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): number | undefined {
  const value = body[field];

  if (value === undefined && !required) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new MasterDataInputError(`${field} must be a positive integer.`);
  }

  return value;
}

function password(
  body: Record<string, unknown>,
  required: boolean,
): string | undefined {
  const value = body.password;

  if (value === undefined && !required) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length < AUTH_CONSTANTS.PASSWORD_MIN_LENGTH ||
    value.length > AUTH_CONSTANTS.PASSWORD_MAX_LENGTH
  ) {
    throw new MasterDataInputError(
      `password must contain between ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} and ${AUTH_CONSTANTS.PASSWORD_MAX_LENGTH} characters.`,
    );
  }

  return value;
}

function optionalTextValue(
  body: Record<string, unknown>,
  field: string,
  maximum: number,
  required: boolean,
): string | null | undefined {
  if (body[field] === null) {
    return null;
  }

  if (body[field] === undefined) {
    return required ? null : undefined;
  }

  const value = text(body, field, maximum, false);

  if (value !== undefined) {
    return value;
  }

  return undefined;
}

function enumValue<T extends string>(
  body: Record<string, unknown>,
  field: string,
  values: readonly T[],
  required: boolean,
): T | undefined {
  const value = body[field];

  if (value === undefined && !required) {
    return undefined;
  }

  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new MasterDataInputError(
      `${field} must be one of: ${values.join(", ")}.`,
    );
  }

  return value as T;
}

function uuidList(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        typeof entry === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(entry),
    )
  ) {
    throw new MasterDataInputError(`${field} must be an array of UUIDs.`);
  }

  if (new Set(value).size !== value.length) {
    throw new MasterDataInputError(`${field} must not contain duplicates.`);
  }

  return value;
}

function result(
  values: Record<string, string | number | Date | null | string[] | undefined>,
): MasterDataInput {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as MasterDataInput;
}

export function parseMasterDataInput(
  resource: MasterDataResource,
  value: unknown,
  operation: "create" | "update",
): { data: MasterDataInput; reason?: string } {
  const body = asObject(value);
  const required = operation === "create";
  const reason = text(body, "auditReason", 2000, false);
  let allowed: readonly string[];
  let data: MasterDataInput;

  switch (resource) {
    case "institutions":
      allowed = ["code", "name", "auditReason"];
      data = result({
        code: text(body, "code", 50, required),
        name: text(body, "name", 200, required),
      });
      break;
    case "academic-years":
      allowed = ["code", "name", "auditReason"];
      data = result({
        code: text(body, "code", 20, required),
        name: text(body, "name", 100, required),
      });
      break;
    case "semesters":
      allowed = ["academicYearId", "code", "name", "auditReason"];
      data = result({
        academicYearId: uuid(body, "academicYearId", required),
        code: text(body, "code", 20, required),
        name: text(body, "name", 100, required),
      });
      break;
    case "teachers":
      allowed = ["code", "name", "phone", "auditReason"];
      data = result({
        code: text(body, "code", 50, required),
        name: text(body, "name", 200, required),
        phone: optionalTextValue(body, "phone", 30, required),
      });
      break;
    case "students":
      allowed = ["code", "name", "nisn", "auditReason"];
      data = result({
        code: text(body, "code", 50, required),
        name: text(body, "name", 200, required),
        nisn: optionalTextValue(body, "nisn", 30, required),
      });
      break;
    case "classes":
      allowed = ["code", "name", "level", "auditReason"];
      data = result({
        code: text(body, "code", 50, required),
        name: text(body, "name", 100, required),
        level: optionalTextValue(body, "level", 30, required),
      });
      break;
    case "student-enrollments": {
      allowed = [
        "studentId",
        "classId",
        "academicYearId",
        "validFrom",
        "validTo",
        "auditReason",
      ];
      const validFrom = date(body, "validFrom", required);
      const validTo = date(body, "validTo", false);

      if (
        validFrom instanceof Date &&
        validTo instanceof Date &&
        validTo < validFrom
      ) {
        throw new MasterDataInputError(
          "validTo must be on or after validFrom.",
        );
      }

      data = result({
        studentId: uuid(body, "studentId", required),
        classId: uuid(body, "classId", required),
        academicYearId: uuid(body, "academicYearId", required),
        validFrom,
        validTo,
      });
      break;
    }
    case "subjects":
      allowed = ["code", "name", "auditReason"];
      data = result({
        code: text(body, "code", 50, required),
        name: text(body, "name", 150, required),
      });
      break;
    case "rooms":
      allowed = ["code", "name", "auditReason"];
      data = result({
        code: text(body, "code", 50, required),
        name: text(body, "name", 100, required),
      });
      break;
    case "schedule-periods":
      allowed = ["periodNumber", "startTime", "endTime", "auditReason"];
      {
        const startTime = time(body, "startTime", required);
        const endTime = time(body, "endTime", required);
        if (
          startTime instanceof Date &&
          endTime instanceof Date &&
          endTime <= startTime
        ) {
          throw new MasterDataInputError(
            "endTime must be later than startTime.",
          );
        }
        data = result({
          periodNumber: positiveInteger(body, "periodNumber", required),
          startTime,
          endTime,
        });
      }
      break;
    case "subject-offerings":
      allowed = [
        "academicYearId",
        "subjectId",
        "offeringType",
        "selectionStartLevel",
        "continuationEndLevel",
        "auditReason",
      ];
      data = result({
        academicYearId: uuid(body, "academicYearId", required),
        subjectId: uuid(body, "subjectId", required),
        offeringType: enumValue(
          body,
          "offeringType",
          ["REGULAR", "ELECTIVE"] as const,
          required,
        ),
        selectionStartLevel: optionalTextValue(
          body,
          "selectionStartLevel",
          30,
          required,
        ),
        continuationEndLevel: optionalTextValue(
          body,
          "continuationEndLevel",
          30,
          required,
        ),
      });
      break;
    case "student-subject-choices":
      allowed = [
        "studentId",
        "subjectOfferingId",
        "startLevel",
        "status",
        "effectiveFrom",
        "effectiveTo",
        "reason",
        "auditReason",
      ];
      {
        const effectiveFrom = date(body, "effectiveFrom", required);
        const effectiveTo = date(body, "effectiveTo", false);
        if (
          effectiveFrom instanceof Date &&
          effectiveTo instanceof Date &&
          effectiveTo < effectiveFrom
        ) {
          throw new MasterDataInputError(
            "effectiveTo must be on or after effectiveFrom.",
          );
        }
        data = result({
          studentId: uuid(body, "studentId", required),
          subjectOfferingId: uuid(body, "subjectOfferingId", required),
          startLevel: text(body, "startLevel", 30, required),
          status: enumValue(
            body,
            "status",
            ["ACTIVE", "ENDED"] as const,
            false,
          ),
          effectiveFrom,
          effectiveTo,
          reason: optionalTextValue(body, "reason", 500, required),
        });
      }
      break;
    case "users":
      allowed = [
        "username",
        "password",
        "status",
        "roleIds",
        "teacherId",
        "auditReason",
      ];
      data = result({
        username: text(body, "username", 100, required),
        password: password(body, required),
        status: enumValue(
          body,
          "status",
          ["ACTIVE", "INACTIVE"] as const,
          false,
        ),
        roleIds: uuidList(body, "roleIds"),
        teacherId: body.teacherId === null
          ? null
          : uuid(body, "teacherId", false),
      });
      break;
  }

  assertFields(body, allowed);

  if (Object.keys(data).length === 0) {
    throw new MasterDataInputError(
      "At least one editable field must be provided.",
    );
  }

  return { data, reason };
}
