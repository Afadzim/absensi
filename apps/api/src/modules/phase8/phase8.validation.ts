export type AcademicCalendarDayType =
  | "EFFECTIVE"
  | "NATIONAL_HOLIDAY"
  | "SPECIAL_HOLIDAY";

export interface CalendarDayInput {
  calendarDate?: Date;
  dayType?: AcademicCalendarDayType;
  label?: string | null;
  auditReason?: string;
}

export interface ReportRange {
  startDate: Date;
  endDate: Date;
}

export class Phase8InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase8InputError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_TYPES: readonly AcademicCalendarDayType[] = [
  "EFFECTIVE",
  "NATIONAL_HOLIDAY",
  "SPECIAL_HOLIDAY",
];

function parseDateOnly(value: unknown, field: string): Date {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new Phase8InputError(`${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Phase8InputError(`${field} must be a valid calendar date.`);
  }
  return parsed;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Phase8InputError("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function parseLabel(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    throw new Phase8InputError("label must be a string or null.");
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Phase8InputError("label must contain 1 to 200 characters.");
  }
  return normalized;
}

function parseAuditReason(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Phase8InputError("auditReason must be a string.");
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 2000) {
    throw new Phase8InputError("auditReason must contain 1 to 2000 characters.");
  }
  return normalized;
}

export function parseCalendarDayInput(
  value: unknown,
  operation: "create" | "update",
): { data: CalendarDayInput; reason?: string } {
  const body = objectBody(value);
  const allowed = operation === "create"
    ? ["calendarDate", "dayType", "label", "auditReason"]
    : ["dayType", "label", "auditReason"];
  const unknown = Object.keys(body).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new Phase8InputError(`Unknown field: ${unknown.join(", ")}`);
  }

  const calendarDate =
    operation === "create"
      ? parseDateOnly(body.calendarDate, "calendarDate")
      : undefined;
  const dayType = body.dayType;
  if (
    dayType !== undefined &&
    (typeof dayType !== "string" ||
      !DAY_TYPES.includes(dayType as AcademicCalendarDayType))
  ) {
    throw new Phase8InputError(
      `dayType must be one of: ${DAY_TYPES.join(", ")}.`,
    );
  }
  if (operation === "create" && dayType === undefined) {
    throw new Phase8InputError("dayType is required.");
  }
  if (
    operation === "update" &&
    dayType === undefined &&
    body.label === undefined
  ) {
    throw new Phase8InputError("At least one calendar field must be provided.");
  }
  const label = parseLabel(body.label);
  const reason = parseAuditReason(body.auditReason);
  return {
    data: { calendarDate, dayType: dayType as AcademicCalendarDayType, label },
    reason,
  };
}

export function parseReportRange(
  startDate: unknown,
  endDate: unknown,
  systemEffectiveDate: Date,
): ReportRange {
  const start = parseDateOnly(startDate, "startDate");
  const end = parseDateOnly(endDate, "endDate");
  if (end < start) {
    throw new Phase8InputError("endDate must be on or after startDate.");
  }
  if (start < systemEffectiveDate) {
    throw new Phase8InputError(
      `Official reports start on ${systemEffectiveDate.toISOString().slice(0, 10)}.`,
    );
  }
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > 366) {
    throw new Phase8InputError("A report range cannot exceed 366 days.");
  }
  return { startDate: start, endDate: end };
}

export function systemEffectiveDate(): Date {
  const value = process.env.SYSTEM_EFFECTIVE_DATE?.trim();
  if (!value) {
    throw new Error("SYSTEM_EFFECTIVE_DATE must be configured.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !DATE_PATTERN.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("SYSTEM_EFFECTIVE_DATE must use a valid YYYY-MM-DD date.");
  }
  return parsed;
}

export function institutionalToday(now = new Date()): Date {
  const timeZone = process.env.ATTENDANCE_TIME_ZONE?.trim() || "Asia/Jakarta";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not determine today's date in ${timeZone}.`);
  }
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}
