export const SCHEDULE_PERMISSIONS = {
  read: "schedule.read",
  create: "schedule.create",
  update: "schedule.update",
} as const;

export const SCHEDULE_WEEKDAY_MIN = 1;
export const SCHEDULE_WEEKDAY_MAX = 7;

export type ScheduleInput = {
  academicYearId?: string;
  semesterId?: string;
  dayOfWeek?: number;
  primaryTeacherId?: string;
  classId?: string;
  subjectId?: string;
  subjectOfferingId?: string | null;
  roomId?: string | null;
  startPeriodNumber?: number;
  endPeriodNumber?: number;
  classParticipantIds?: string[];
};

export type ScheduleStudentParticipantInput = {
  studentId?: string;
  action?: "INCLUDE" | "EXCLUDE";
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  reason?: string | null;
};

export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleInputError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScheduleInputError("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function parseUuid(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ScheduleInputError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseNullableUuid(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): string | null | undefined {
  if (body[field] === null) return null;
  return parseUuid(body, field, required);
}

function parsePositiveInteger(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): number | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ScheduleInputError(`${field} must be a positive integer.`);
  }
  return value;
}

function parseDate(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): Date | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new ScheduleInputError(`${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ScheduleInputError(`${field} must be a valid calendar date.`);
  }
  return parsed;
}

function parseText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  required: boolean,
): string | null | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (value === null && !required) return null;
  if (typeof value !== "string") {
    throw new ScheduleInputError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ScheduleInputError(
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function parseClassParticipantIds(
  body: Record<string, unknown>,
): string[] | undefined {
  const value = body.classParticipantIds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && UUID_PATTERN.test(entry))) {
    throw new ScheduleInputError("classParticipantIds must be an array of UUIDs.");
  }
  if (new Set(value).size !== value.length) {
    throw new ScheduleInputError("classParticipantIds must not contain duplicates.");
  }
  return value;
}

export function parseScheduleInput(
  value: unknown,
  operation: "create" | "update",
): { data: ScheduleInput; reason?: string } {
  const body = asObject(value);
  const required = operation === "create";
  const allowed = [
    "academicYearId",
    "semesterId",
    "dayOfWeek",
    "primaryTeacherId",
    "classId",
    "subjectId",
    "subjectOfferingId",
    "roomId",
    "startPeriodNumber",
    "endPeriodNumber",
    "classParticipantIds",
    "auditReason",
  ];
  const unknownFields = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknownFields.length > 0) {
    throw new ScheduleInputError(`Unknown field: ${unknownFields.join(", ")}`);
  }

  const dayOfWeek = parsePositiveInteger(body, "dayOfWeek", required);
  if (dayOfWeek !== undefined && dayOfWeek > SCHEDULE_WEEKDAY_MAX) {
    throw new ScheduleInputError("dayOfWeek must be between 1 and 7 (Monday=1, Sunday=7).");
  }

  const startPeriodNumber = parsePositiveInteger(body, "startPeriodNumber", required);
  const endPeriodNumber = parsePositiveInteger(body, "endPeriodNumber", required);
  if (
    startPeriodNumber !== undefined &&
    endPeriodNumber !== undefined &&
    endPeriodNumber < startPeriodNumber
  ) {
    throw new ScheduleInputError("endPeriodNumber must be on or after startPeriodNumber.");
  }

  const reason = parseText(body, "auditReason", 2000, false);
  const data: ScheduleInput = {
    academicYearId: parseUuid(body, "academicYearId", required),
    semesterId: parseUuid(body, "semesterId", required),
    dayOfWeek,
    primaryTeacherId: parseUuid(body, "primaryTeacherId", required),
    classId: parseUuid(body, "classId", required),
    subjectId: parseUuid(body, "subjectId", required),
    subjectOfferingId: parseNullableUuid(body, "subjectOfferingId", false),
    roomId: parseNullableUuid(body, "roomId", false),
    startPeriodNumber,
    endPeriodNumber,
    classParticipantIds: parseClassParticipantIds(body),
  };

  for (const [key, item] of Object.entries(data)) {
    if (item === undefined) delete data[key as keyof ScheduleInput];
  }
  if (Object.keys(data).length === 0) {
    throw new ScheduleInputError("At least one editable field must be provided.");
  }
  return { data, reason: reason ?? undefined };
}

export function parseScheduleStudentParticipantInput(
  value: unknown,
  operation: "create" | "update",
): { data: ScheduleStudentParticipantInput; auditReason?: string } {
  const body = asObject(value);
  const required = operation === "create";
  const allowed = [
    "studentId",
    "action",
    "effectiveFrom",
    "effectiveTo",
    "reason",
    "auditReason",
  ];
  const unknownFields = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknownFields.length > 0) {
    throw new ScheduleInputError(`Unknown field: ${unknownFields.join(", ")}`);
  }

  const action = body.action;
  if (
    action !== undefined &&
    action !== "INCLUDE" &&
    action !== "EXCLUDE"
  ) {
    throw new ScheduleInputError("action must be INCLUDE or EXCLUDE.");
  }
  if (required && action === undefined) {
    throw new ScheduleInputError("action is required.");
  }

  const effectiveFrom = parseDate(body, "effectiveFrom", required);
  const effectiveTo =
    body.effectiveTo === null
      ? null
      : parseDate(body, "effectiveTo", false);
  if (
    effectiveFrom &&
    effectiveTo instanceof Date &&
    effectiveTo < effectiveFrom
  ) {
    throw new ScheduleInputError("effectiveTo must be on or after effectiveFrom.");
  }

  const data: ScheduleStudentParticipantInput = {
    studentId: parseUuid(body, "studentId", required),
    action: action as "INCLUDE" | "EXCLUDE" | undefined,
    effectiveFrom,
    effectiveTo,
    reason: parseText(body, "reason", 500, false),
  };
  for (const [key, item] of Object.entries(data)) {
    if (item === undefined) delete data[key as keyof ScheduleStudentParticipantInput];
  }

  const auditReason = parseText(body, "auditReason", 2000, false);
  if (Object.keys(data).length === 0) {
    throw new ScheduleInputError("At least one editable field must be provided.");
  }
  return { data, auditReason: auditReason ?? undefined };
}

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function getIsoWeekday(date: Date): number {
  const utcWeekday = date.getUTCDay();
  return utcWeekday === 0 ? 7 : utcWeekday;
}
