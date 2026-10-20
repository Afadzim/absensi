import { Prisma } from "../../../generated/prisma/client.js";
import type { AuthContext } from "../auth/auth.context.js";
import { hashPassword } from "../auth/auth.crypto.js";
import { prisma } from "../../lib/prisma.js";
import {
  MASTER_DATA_RESOURCES,
  MasterDataInputError,
  parseMasterDataInput,
  type MasterDataInput,
  type MasterDataResource,
} from "./master-data.validation.js";

export interface MasterDataAuditContext {
  auth: AuthContext;
  requestId: string;
  ipAddress: string;
  userAgent?: string;
}

export interface MasterDataPage {
  page: number;
  pageSize: number;
}

export class MasterDataNotFoundError extends Error {
  constructor() {
    super("Master data record not found.");
    this.name = "MasterDataNotFoundError";
  }
}

export class MasterDataConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterDataConflictError";
  }
}

function isResource(value: string): value is MasterDataResource {
  return MASTER_DATA_RESOURCES.some((resource) => resource === value);
}

export function parseMasterDataResource(
  value: string,
): MasterDataResource | null {
  return isResource(value) ? value : null;
}

function requireString(data: MasterDataInput, key: string): string {
  const value = data[key];
  if (typeof value !== "string") {
    throw new MasterDataInputError(`${key} is required.`);
  }
  return value;
}

function optionalString(data: MasterDataInput, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new MasterDataInputError(`${key} must be a string.`);
  }
  return value;
}

function optionalStringOrNull(
  data: MasterDataInput,
  key: string,
): string | null | undefined {
  const value = data[key];
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") {
    throw new MasterDataInputError(`${key} must be a string or null.`);
  }
  return value;
}

function requireNumber(data: MasterDataInput, key: string): number {
  const value = data[key];
  if (typeof value !== "number") {
    throw new MasterDataInputError(`${key} is required.`);
  }
  return value;
}

function requireDate(data: MasterDataInput, key: string): Date {
  const value = data[key];
  if (!(value instanceof Date)) {
    throw new MasterDataInputError(`${key} is required.`);
  }
  return value;
}

function optionalDate(data: MasterDataInput, key: string): Date | null | undefined {
  const value = data[key];
  if (value === null || value === undefined) return value;
  if (!(value instanceof Date)) {
    throw new MasterDataInputError(`${key} must be a date or null.`);
  }
  return value;
}

function optionalUuid(data: MasterDataInput, key: string): string | undefined {
  return optionalString(data, key);
}

function optionalStringList(
  data: MasterDataInput,
  key: string,
): string[] | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new MasterDataInputError(`${key} must be an array of UUIDs.`);
  }
  return value;
}

function auditJson(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  context: MasterDataAuditContext,
  action: "CREATE" | "UPDATE",
  entity: string,
  entityId: string,
  before: object | null,
  after: object,
  reason?: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      institutionId: context.auth.institutionId,
      actorUserId: context.auth.userId,
      actorInstitutionId: context.auth.institutionId,
      action,
      entity,
      entityId,
      beforeData: before ? auditJson(before) : Prisma.JsonNull,
      afterData: auditJson(after),
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      reason,
    },
  });
}

function pagination(page: MasterDataPage): { skip: number; take: number } {
  return {
    skip: (page.page - 1) * page.pageSize,
    take: page.pageSize,
  };
}

const userView = {
  id: true,
  institutionId: true,
  username: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  teacher: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  roles: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type UserView = Prisma.UserGetPayload<{ select: typeof userView }>;

function publicUser(user: UserView) {
  return {
    id: user.id,
    institutionId: user.institutionId,
    username: user.username,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    teacher: user.teacher,
    roles: user.roles.map(({ role }) => role),
  };
}

export class MasterDataService {
  async listRoles(): Promise<Array<{ id: string; name: string; description: string | null }>> {
    return prisma.role.findMany({
      select: {
        id: true,
        name: true,
        description: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  async list(
    resource: MasterDataResource,
    institutionId: string,
    page: MasterDataPage,
  ): Promise<{ data: unknown[]; total: number }> {
    const paging = pagination(page);
    switch (resource) {
      case "institutions": {
        const where = { id: institutionId };
        const [data, total] = await Promise.all([
          prisma.institution.findMany({
            where,
            ...paging,
            orderBy: [{ code: "asc" }, { id: "asc" }],
          }),
          prisma.institution.count({ where }),
        ]);
        return { data, total };
      }
      case "academic-years": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.academicYear.findMany({
            where,
            ...paging,
            orderBy: [{ code: "asc" }, { id: "asc" }],
          }),
          prisma.academicYear.count({ where }),
        ]);
        return { data, total };
      }
      case "semesters": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.semester.findMany({
            where,
            ...paging,
            orderBy: [{ academicYearId: "asc" }, { code: "asc" }],
          }),
          prisma.semester.count({ where }),
        ]);
        return { data, total };
      }
      case "teachers": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.teacher.findMany({
            where,
            ...paging,
            orderBy: [{ name: "asc" }, { id: "asc" }],
            select: {
              id: true,
              institutionId: true,
              code: true,
              name: true,
              phone: true,
              userId: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          prisma.teacher.count({ where }),
        ]);
        return { data, total };
      }
      case "students": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.student.findMany({
            where,
            ...paging,
            orderBy: [{ name: "asc" }, { id: "asc" }],
          }),
          prisma.student.count({ where }),
        ]);
        return { data, total };
      }
      case "classes": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.class.findMany({
            where,
            ...paging,
            orderBy: [{ name: "asc" }, { id: "asc" }],
          }),
          prisma.class.count({ where }),
        ]);
        return { data, total };
      }
      case "student-enrollments": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.studentClassEnrollment.findMany({
            where,
            ...paging,
            orderBy: [{ validFrom: "desc" }, { id: "asc" }],
            include: {
              student: { select: { code: true, name: true } },
              class: { select: { code: true, name: true } },
              academicYear: { select: { code: true, name: true } },
            },
          }),
          prisma.studentClassEnrollment.count({ where }),
        ]);
        return { data, total };
      }
      case "subjects": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.subject.findMany({
            where,
            ...paging,
            orderBy: [{ name: "asc" }, { id: "asc" }],
          }),
          prisma.subject.count({ where }),
        ]);
        return { data, total };
      }
      case "rooms": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.room.findMany({
            where,
            ...paging,
            orderBy: [{ name: "asc" }, { id: "asc" }],
          }),
          prisma.room.count({ where }),
        ]);
        return { data, total };
      }
      case "schedule-periods": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.schedulePeriod.findMany({
            where,
            ...paging,
            orderBy: [{ periodNumber: "asc" }, { id: "asc" }],
          }),
          prisma.schedulePeriod.count({ where }),
        ]);
        return { data, total };
      }
      case "subject-offerings": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.subjectOffering.findMany({
            where,
            ...paging,
            orderBy: [{ academicYearId: "asc" }, { subjectId: "asc" }],
            include: {
              academicYear: { select: { code: true, name: true } },
              subject: { select: { code: true, name: true } },
            },
          }),
          prisma.subjectOffering.count({ where }),
        ]);
        return { data, total };
      }
      case "student-subject-choices": {
        const where = { institutionId };
        const [data, total] = await Promise.all([
          prisma.studentSubjectChoice.findMany({
            where,
            ...paging,
            orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
            include: {
              student: { select: { code: true, name: true } },
              subjectOffering: {
                include: { subject: { select: { code: true, name: true } } },
              },
            },
          }),
          prisma.studentSubjectChoice.count({ where }),
        ]);
        return { data, total };
      }
      case "users": {
        const where = { institutionId };
        const [users, total] = await Promise.all([
          prisma.user.findMany({
            where,
            ...paging,
            orderBy: [{ username: "asc" }, { id: "asc" }],
            select: userView,
          }),
          prisma.user.count({ where }),
        ]);
        return { data: users.map(publicUser), total };
      }
    }
  }

  async get(
    resource: MasterDataResource,
    institutionId: string,
    id: string,
  ): Promise<unknown | null> {
    switch (resource) {
      case "institutions":
        if (id !== institutionId) return null;
        return prisma.institution.findUnique({ where: { id } });
      case "academic-years":
        return prisma.academicYear.findFirst({ where: { id, institutionId } });
      case "semesters":
        return prisma.semester.findFirst({ where: { id, institutionId } });
      case "teachers":
        return prisma.teacher.findFirst({
          where: { id, institutionId },
          select: {
            id: true,
            institutionId: true,
            code: true,
            name: true,
            phone: true,
            userId: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      case "students":
        return prisma.student.findFirst({ where: { id, institutionId } });
      case "classes":
        return prisma.class.findFirst({ where: { id, institutionId } });
      case "student-enrollments":
        return prisma.studentClassEnrollment.findFirst({
          where: { id, institutionId },
          include: {
            student: { select: { code: true, name: true } },
            class: { select: { code: true, name: true } },
            academicYear: { select: { code: true, name: true } },
          },
        });
      case "subjects":
        return prisma.subject.findFirst({ where: { id, institutionId } });
      case "rooms":
        return prisma.room.findFirst({ where: { id, institutionId } });
      case "schedule-periods":
        return prisma.schedulePeriod.findFirst({
          where: { id, institutionId },
        });
      case "subject-offerings":
        return prisma.subjectOffering.findFirst({
          where: { id, institutionId },
          include: {
            academicYear: { select: { code: true, name: true } },
            subject: { select: { code: true, name: true } },
          },
        });
      case "student-subject-choices":
        return prisma.studentSubjectChoice.findFirst({
          where: { id, institutionId },
          include: {
            student: { select: { code: true, name: true } },
            subjectOffering: {
              include: { subject: { select: { code: true, name: true } } },
            },
          },
        });
      case "users": {
        const user = await prisma.user.findFirst({
          where: { id, institutionId },
          select: userView,
        });
        return user ? publicUser(user) : null;
      }
    }
  }

  async create(
    resource: MasterDataResource,
    context: MasterDataAuditContext,
    body: unknown,
  ): Promise<unknown> {
    const { data, reason } = parseMasterDataInput(resource, body, "create");
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      switch (resource) {
        case "institutions":
          throw new MasterDataInputError(
            "Institution creation is managed through owner provisioning.",
          );
        case "academic-years": {
          const row = await tx.academicYear.create({
            data: {
              institutionId,
              code: requireString(data, "code"),
              name: requireString(data, "name"),
            },
          });
          await writeAudit(tx, context, "CREATE", "AcademicYear", row.id, null, row, reason);
          return row;
        }
        case "semesters": {
          const row = await tx.semester.create({
            data: {
              institutionId,
              academicYearId: requireString(data, "academicYearId"),
              code: requireString(data, "code"),
              name: requireString(data, "name"),
            },
          });
          await writeAudit(tx, context, "CREATE", "Semester", row.id, null, row, reason);
          return row;
        }
        case "teachers": {
          const row = await tx.teacher.create({
            data: {
              institutionId,
              code: requireString(data, "code"),
              name: requireString(data, "name"),
              phone: optionalStringOrNull(data, "phone") ?? null,
            },
          });
          await writeAudit(tx, context, "CREATE", "Teacher", row.id, null, row, reason);
          return row;
        }
        case "students": {
          const row = await tx.student.create({
            data: {
              institutionId,
              code: requireString(data, "code"),
              name: requireString(data, "name"),
              nisn: optionalStringOrNull(data, "nisn") ?? null,
            },
          });
          await writeAudit(tx, context, "CREATE", "Student", row.id, null, row, reason);
          return row;
        }
        case "classes": {
          const row = await tx.class.create({
            data: {
              institutionId,
              code: requireString(data, "code"),
              name: requireString(data, "name"),
              level: optionalStringOrNull(data, "level") ?? null,
            },
          });
          await writeAudit(tx, context, "CREATE", "Class", row.id, null, row, reason);
          return row;
        }
        case "student-enrollments": {
          const studentId = requireString(data, "studentId");
          const academicYearId = requireString(data, "academicYearId");
          const validFrom = requireDate(data, "validFrom");
          const validTo = optionalDate(data, "validTo") ?? null;
          await this.assertNoEnrollmentOverlap(
            tx,
            institutionId,
            studentId,
            academicYearId,
            validFrom,
            validTo,
          );
          const row = await tx.studentClassEnrollment.create({
            data: {
              institutionId,
              studentId,
              academicYearId,
              classId: requireString(data, "classId"),
              validFrom,
              validTo,
            },
            include: {
              student: { select: { code: true, name: true } },
              class: { select: { code: true, name: true } },
              academicYear: { select: { code: true, name: true } },
            },
          });
          await writeAudit(
            tx,
            context,
            "CREATE",
            "StudentClassEnrollment",
            row.id,
            null,
            row,
            reason,
          );
          return row;
        }
        case "subjects": {
          const row = await tx.subject.create({
            data: {
              institutionId,
              code: requireString(data, "code"),
              name: requireString(data, "name"),
            },
          });
          await writeAudit(tx, context, "CREATE", "Subject", row.id, null, row, reason);
          return row;
        }
        case "rooms": {
          const row = await tx.room.create({
            data: {
              institutionId,
              code: requireString(data, "code"),
              name: requireString(data, "name"),
            },
          });
          await writeAudit(tx, context, "CREATE", "Room", row.id, null, row, reason);
          return row;
        }
        case "schedule-periods": {
          const row = await tx.schedulePeriod.create({
            data: {
              institutionId,
              periodNumber: requireNumber(data, "periodNumber"),
              startTime: requireDate(data, "startTime"),
              endTime: requireDate(data, "endTime"),
            },
          });
          await writeAudit(
            tx,
            context,
            "CREATE",
            "SchedulePeriod",
            row.id,
            null,
            row,
            reason,
          );
          return row;
        }
        case "subject-offerings": {
          const row = await tx.subjectOffering.create({
            data: {
              institutionId,
              academicYearId: requireString(data, "academicYearId"),
              subjectId: requireString(data, "subjectId"),
              offeringType: requireString(data, "offeringType") as
                | "REGULAR"
                | "ELECTIVE",
              selectionStartLevel:
                optionalStringOrNull(data, "selectionStartLevel") ?? null,
              continuationEndLevel:
                optionalStringOrNull(data, "continuationEndLevel") ?? null,
            },
          });
          await writeAudit(
            tx,
            context,
            "CREATE",
            "SubjectOffering",
            row.id,
            null,
            row,
            reason,
          );
          return row;
        }
        case "student-subject-choices": {
          const row = await tx.studentSubjectChoice.create({
            data: {
              institutionId,
              studentId: requireString(data, "studentId"),
              subjectOfferingId: requireString(data, "subjectOfferingId"),
              startLevel: requireString(data, "startLevel"),
              status: (optionalString(data, "status") ?? "ACTIVE") as
                | "ACTIVE"
                | "ENDED",
              effectiveFrom: requireDate(data, "effectiveFrom"),
              effectiveTo: optionalDate(data, "effectiveTo") ?? null,
              reason: optionalStringOrNull(data, "reason") ?? null,
            },
          });
          await writeAudit(
            tx,
            context,
            "CREATE",
            "StudentSubjectChoice",
            row.id,
            null,
            row,
            reason,
          );
          return row;
        }
        case "users":
          return this.createUser(tx, context, data, reason);
      }
    });
  }

  private async assertNoEnrollmentOverlap(
    tx: Prisma.TransactionClient,
    institutionId: string,
    studentId: string,
    academicYearId: string,
    validFrom: Date,
    validTo: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const existing = await tx.studentClassEnrollment.findFirst({
      where: {
        institutionId,
        studentId,
        academicYearId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...(validTo ? { validFrom: { lte: validTo } } : {}),
        OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
      },
      select: { id: true },
    });

    if (existing) {
      throw new MasterDataConflictError(
        "Student already has an enrollment overlapping this date range in the academic year.",
      );
    }
  }

  private async createUser(
    tx: Prisma.TransactionClient,
    context: MasterDataAuditContext,
    data: MasterDataInput,
    reason?: string,
  ) {
    const roleIds = optionalStringList(data, "roleIds") ?? [];
    const teacherId = optionalUuid(data, "teacherId");
    const password = requireString(data, "password");
    const user = await tx.user.create({
      data: {
        institutionId: context.auth.institutionId,
        username: requireString(data, "username"),
        passwordHash: await hashPassword(password),
        status: (optionalString(data, "status") ?? "ACTIVE") as
          | "ACTIVE"
          | "INACTIVE",
        roles: {
          create: roleIds.map((roleId) => ({
            role: { connect: { id: roleId } },
          })),
        },
      },
      select: userView,
    });

    if (teacherId) {
      await this.attachTeacher(
        tx,
        context,
        user.id,
        teacherId,
      );
    }

    const after = await tx.user.findFirstOrThrow({
      where: { id: user.id, institutionId: context.auth.institutionId },
      select: userView,
    });
    const snapshot = publicUser(after);
    await writeAudit(
      tx,
      context,
      "CREATE",
      "User",
      user.id,
      null,
      snapshot,
      reason,
    );
    return snapshot;
  }

  private async attachTeacher(
    tx: Prisma.TransactionClient,
    context: MasterDataAuditContext,
    userId: string,
    teacherId: string,
  ): Promise<void> {
    const institutionId = context.auth.institutionId;
    const existing = await tx.teacher.findFirst({
      where: { institutionId, userId },
      select: { id: true, userId: true, userInstitutionId: true },
    });
    if (existing) {
      if (existing.id === teacherId) return;
      const detached = await tx.teacher.update({
        where: { id: existing.id },
        data: { userId: null, userInstitutionId: null },
      });
      await writeAudit(
        tx,
        context,
        "UPDATE",
        "Teacher",
        detached.id,
        existing,
        { ...existing, userId: null, userInstitutionId: null },
      );
    }

    const teacher = await tx.teacher.findFirst({
      where: { id: teacherId, institutionId },
      select: {
        id: true,
        userId: true,
        userInstitutionId: true,
      },
    });
    if (!teacher) throw new MasterDataNotFoundError();
    if (teacher.userId && teacher.userId !== userId) {
      throw new MasterDataConflictError(
        "Teacher is already linked to another user.",
      );
    }
    const linked = await tx.teacher.update({
      where: { id: teacher.id },
      data: { userId, userInstitutionId: institutionId },
    });
    await writeAudit(
      tx,
      context,
      "UPDATE",
      "Teacher",
      linked.id,
      teacher,
      { ...teacher, userId, userInstitutionId: institutionId },
    );
  }

  async update(
    resource: MasterDataResource,
    context: MasterDataAuditContext,
    id: string,
    body: unknown,
  ): Promise<unknown | null> {
    const { data, reason } = parseMasterDataInput(resource, body, "update");
    const institutionId = context.auth.institutionId;
    return prisma.$transaction(async (tx) => {
      switch (resource) {
        case "institutions": {
          if (id !== institutionId) return null;
          const before = await tx.institution.findUnique({
            where: { id: institutionId },
          });
          if (!before) return null;
          const row = await tx.institution.update({
            where: { id: institutionId },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
            },
          });
          await writeAudit(
            tx,
            context,
            "UPDATE",
            "Institution",
            id,
            before,
            row,
            reason,
          );
          return row;
        }
        case "academic-years": {
          const before = await tx.academicYear.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.academicYear.update({
            where: { id },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "AcademicYear", id, before, row, reason);
          return row;
        }
        case "semesters": {
          const before = await tx.semester.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.semester.update({
            where: { id },
            data: {
              academicYearId: optionalUuid(data, "academicYearId"),
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "Semester", id, before, row, reason);
          return row;
        }
        case "teachers": {
          const before = await tx.teacher.findFirst({
            where: { id, institutionId },
            select: {
              id: true,
              institutionId: true,
              code: true,
              name: true,
              phone: true,
              userId: true,
              userInstitutionId: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          if (!before) return null;
          const row = await tx.teacher.update({
            where: { id },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
              phone: optionalStringOrNull(data, "phone"),
            },
            select: {
              id: true,
              institutionId: true,
              code: true,
              name: true,
              phone: true,
              userId: true,
              userInstitutionId: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          await writeAudit(tx, context, "UPDATE", "Teacher", id, before, row, reason);
          return row;
        }
        case "students": {
          const before = await tx.student.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.student.update({
            where: { id },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
              nisn: optionalStringOrNull(data, "nisn"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "Student", id, before, row, reason);
          return row;
        }
        case "classes": {
          const before = await tx.class.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.class.update({
            where: { id },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
              level: optionalStringOrNull(data, "level"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "Class", id, before, row, reason);
          return row;
        }
        case "student-enrollments":
          return this.updateEnrollment(tx, context, id, data, reason);
        case "subjects": {
          const before = await tx.subject.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.subject.update({
            where: { id },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "Subject", id, before, row, reason);
          return row;
        }
        case "rooms": {
          const before = await tx.room.findFirst({ where: { id, institutionId } });
          if (!before) return null;
          const row = await tx.room.update({
            where: { id },
            data: {
              code: optionalString(data, "code"),
              name: optionalString(data, "name"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "Room", id, before, row, reason);
          return row;
        }
        case "schedule-periods": {
          const before = await tx.schedulePeriod.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const startTime = data.startTime === undefined
            ? before.startTime
            : requireDate(data, "startTime");
          const endTime = data.endTime === undefined
            ? before.endTime
            : requireDate(data, "endTime");
          if (endTime <= startTime) {
            throw new MasterDataInputError(
              "endTime must be later than startTime.",
            );
          }
          const row = await tx.schedulePeriod.update({
            where: { id },
            data: {
              periodNumber: data.periodNumber === undefined
                ? undefined
                : requireNumber(data, "periodNumber"),
              startTime,
              endTime,
            },
          });
          await writeAudit(tx, context, "UPDATE", "SchedulePeriod", id, before, row, reason);
          return row;
        }
        case "subject-offerings": {
          const before = await tx.subjectOffering.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.subjectOffering.update({
            where: { id },
            data: {
              academicYearId: optionalUuid(data, "academicYearId"),
              subjectId: optionalUuid(data, "subjectId"),
              offeringType: optionalString(data, "offeringType") as
                | "REGULAR"
                | "ELECTIVE"
                | undefined,
              selectionStartLevel: optionalStringOrNull(data, "selectionStartLevel"),
              continuationEndLevel: optionalStringOrNull(data, "continuationEndLevel"),
            },
          });
          await writeAudit(tx, context, "UPDATE", "SubjectOffering", id, before, row, reason);
          return row;
        }
        case "student-subject-choices": {
          const before = await tx.studentSubjectChoice.findFirst({
            where: { id, institutionId },
          });
          if (!before) return null;
          const row = await tx.studentSubjectChoice.update({
            where: { id },
            data: {
              studentId: optionalUuid(data, "studentId"),
              subjectOfferingId: optionalUuid(data, "subjectOfferingId"),
              startLevel: optionalString(data, "startLevel"),
              status: optionalString(data, "status") as "ACTIVE" | "ENDED" | undefined,
              effectiveFrom: data.effectiveFrom === undefined
                ? undefined
                : requireDate(data, "effectiveFrom"),
              effectiveTo: optionalDate(data, "effectiveTo"),
              reason: optionalStringOrNull(data, "reason"),
            },
          });
          await writeAudit(
            tx,
            context,
            "UPDATE",
            "StudentSubjectChoice",
            id,
            before,
            row,
            reason,
          );
          return row;
        }
        case "users":
          return this.updateUser(tx, context, id, data, reason);
      }
    });
  }

  private async updateEnrollment(
    tx: Prisma.TransactionClient,
    context: MasterDataAuditContext,
    id: string,
    data: MasterDataInput,
    reason?: string,
  ) {
    const institutionId = context.auth.institutionId;
    const before = await tx.studentClassEnrollment.findFirst({
      where: { id, institutionId },
    });
    if (!before) return null;

    const studentId = optionalUuid(data, "studentId") ?? before.studentId;
    const academicYearId =
      optionalUuid(data, "academicYearId") ?? before.academicYearId;
    const validFrom = data.validFrom === undefined
      ? before.validFrom
      : requireDate(data, "validFrom");
    const validTo = data.validTo === undefined
      ? before.validTo
      : optionalDate(data, "validTo") ?? null;
    if (validTo && validTo < validFrom) {
      throw new MasterDataInputError(
        "validTo must be on or after validFrom.",
      );
    }

    await this.assertNoEnrollmentOverlap(
      tx,
      institutionId,
      studentId,
      academicYearId,
      validFrom,
      validTo,
      id,
    );
    const row = await tx.studentClassEnrollment.update({
      where: { id },
      data: {
        studentId,
        classId: optionalUuid(data, "classId"),
        academicYearId,
        validFrom,
        validTo,
      },
      include: {
        student: { select: { code: true, name: true } },
        class: { select: { code: true, name: true } },
        academicYear: { select: { code: true, name: true } },
      },
    });
    await writeAudit(tx, context, "UPDATE", "StudentClassEnrollment", id, before, row, reason);
    return row;
  }

  private async updateUser(
    tx: Prisma.TransactionClient,
    context: MasterDataAuditContext,
    id: string,
    data: MasterDataInput,
    reason?: string,
  ) {
    const institutionId = context.auth.institutionId;
    const before = await tx.user.findFirst({
      where: { id, institutionId },
      select: userView,
    });
    if (!before) return null;
    const beforeSnapshot = publicUser(before);

    const updateData: Prisma.UserUpdateInput = {
      username: optionalString(data, "username"),
      status: optionalString(data, "status") as "ACTIVE" | "INACTIVE" | undefined,
      passwordHash:
        data.password === undefined
          ? undefined
          : await hashPassword(requireString(data, "password")),
    };
    await tx.user.update({
      where: { id },
      data: updateData,
    });

    const roleIds = optionalStringList(data, "roleIds");
    if (roleIds !== undefined) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: id, roleId })),
        });
      }
    }

    if (Object.hasOwn(data, "teacherId")) {
      const newTeacherId = optionalUuid(data, "teacherId");
      const currentTeacher = await tx.teacher.findFirst({
        where: { institutionId, userId: id },
        select: { id: true, userId: true, userInstitutionId: true },
      });
      if (currentTeacher && currentTeacher.id !== newTeacherId) {
        const detached = await tx.teacher.update({
          where: { id: currentTeacher.id },
          data: { userId: null, userInstitutionId: null },
        });
        await writeAudit(
          tx,
          context,
          "UPDATE",
          "Teacher",
          detached.id,
          currentTeacher,
          { ...currentTeacher, userId: null, userInstitutionId: null },
        );
      }
      if (newTeacherId) {
        await this.attachTeacher(tx, context, id, newTeacherId);
      }
    }

    const after = await tx.user.findFirstOrThrow({
      where: { id, institutionId },
      select: userView,
    });
    const afterSnapshot = publicUser(after);
    await writeAudit(
      tx,
      context,
      "UPDATE",
      "User",
      id,
      beforeSnapshot,
      afterSnapshot,
      reason,
    );
    return afterSnapshot;
  }
}
