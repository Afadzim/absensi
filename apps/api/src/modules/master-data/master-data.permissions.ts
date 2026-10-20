import type { MasterDataResource } from "./master-data.validation.js";

export const MASTER_DATA_PERMISSIONS = {
  institutions: {
    read: "master_data.institution.read",
    update: "master_data.institution.update",
  },
  "academic-years": {
    read: "master_data.academic-year.read",
    create: "master_data.academic-year.create",
    update: "master_data.academic-year.update",
  },
  semesters: {
    read: "master_data.semester.read",
    create: "master_data.semester.create",
    update: "master_data.semester.update",
  },
  teachers: {
    read: "master_data.teacher.read",
    create: "master_data.teacher.create",
    update: "master_data.teacher.update",
  },
  students: {
    read: "master_data.student.read",
    create: "master_data.student.create",
    update: "master_data.student.update",
  },
  classes: {
    read: "master_data.class.read",
    create: "master_data.class.create",
    update: "master_data.class.update",
  },
  "student-enrollments": {
    read: "master_data.student-enrollment.read",
    create: "master_data.student-enrollment.create",
    update: "master_data.student-enrollment.update",
  },
  subjects: {
    read: "master_data.subject.read",
    create: "master_data.subject.create",
    update: "master_data.subject.update",
  },
  rooms: {
    read: "master_data.room.read",
    create: "master_data.room.create",
    update: "master_data.room.update",
  },
  "schedule-periods": {
    read: "master_data.schedule-period.read",
    create: "master_data.schedule-period.create",
    update: "master_data.schedule-period.update",
  },
  "subject-offerings": {
    read: "master_data.subject-offering.read",
    create: "master_data.subject-offering.create",
    update: "master_data.subject-offering.update",
  },
  "student-subject-choices": {
    read: "master_data.student-subject-choice.read",
    create: "master_data.student-subject-choice.create",
    update: "master_data.student-subject-choice.update",
  },
  users: {
    read: "master_data.user.read",
    create: "master_data.user.create",
    update: "master_data.user.update",
  },
} satisfies Record<
  MasterDataResource,
  Partial<{ read: string; create: string; update: string }>
>;
