/*
  Migration: v1.4
  Purpose:
  - Add SubjectOffering
  - Add StudentSubjectChoice
  - Add ScheduleClassParticipant
  - Add ScheduleStudentParticipant
  - Add Schedule -> SubjectOffering academic-context integrity
  - Add Schedule -> Semester -> AcademicYear integrity
  - Add AttendanceSession subjectOffering snapshot

  IMPORTANT:
  The first executable statement is the preflight DO block.
  It aborts the migration if existing Schedule data violates
  Schedule -> Semester -> AcademicYear integrity.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Schedule" s
    JOIN "Semester" sem
      ON sem."institutionId" = s."institutionId"
     AND sem."id" = s."semesterId"
    WHERE s."academicYearId" <> sem."academicYearId"
  ) THEN
    RAISE EXCEPTION
      'V1.4 PRECHECK FAILED: Schedule.academicYearId does not match Semester.academicYearId';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Schedule" s
    WHERE NOT EXISTS (
      SELECT 1
      FROM "Semester" sem
      WHERE sem."institutionId" = s."institutionId"
        AND sem."id" = s."semesterId"
    )
  ) THEN
    RAISE EXCEPTION
      'V1.4 PRECHECK FAILED: Schedule.semesterId does not belong to the same institution';
  END IF;
END $$;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE "SubjectOfferingType" AS ENUM (
  'REGULAR',
  'ELECTIVE'
);

CREATE TYPE "ScheduleStudentParticipantAction" AS ENUM (
  'INCLUDE',
  'EXCLUDE'
);

CREATE TYPE "StudentSubjectChoiceStatus" AS ENUM (
  'ACTIVE',
  'ENDED'
);

-- ============================================================
-- SEMESTER / ACADEMIC-YEAR INTEGRITY
-- ============================================================

CREATE UNIQUE INDEX "Semester_id_institutionId_academicYearId_key"
ON "Semester" ("id", "institutionId", "academicYearId");

ALTER TABLE "Schedule"
  DROP CONSTRAINT "Schedule_institutionId_semesterId_fkey";

ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_institutionId_semesterId_academicYearId_fkey"
  FOREIGN KEY ("institutionId", "semesterId", "academicYearId")
  REFERENCES "Semester" ("institutionId", "id", "academicYearId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- ============================================================
-- SUBJECT OFFERING
-- ============================================================

CREATE TABLE "SubjectOffering" (
  "id" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "academicYearId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "offeringType" "SubjectOfferingType" NOT NULL,
  "selectionStartLevel" VARCHAR(30),
  "continuationEndLevel" VARCHAR(30),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "SubjectOffering_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "SubjectOffering_institutionId_fkey"
    FOREIGN KEY ("institutionId")
    REFERENCES "Institution" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "SubjectOffering_institutionId_academicYearId_fkey"
    FOREIGN KEY ("institutionId", "academicYearId")
    REFERENCES "AcademicYear" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "SubjectOffering_institutionId_subjectId_fkey"
    FOREIGN KEY ("institutionId", "subjectId")
    REFERENCES "Subject" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "SubjectOffering_elective_level_check"
    CHECK (
      "offeringType" <> 'ELECTIVE'
      OR (
        "selectionStartLevel" IS NOT NULL
        AND "continuationEndLevel" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "SubjectOffering_institutionId_academicYearId_subjectId_offeringType_key"
ON "SubjectOffering" ("institutionId", "academicYearId", "subjectId", "offeringType");

CREATE UNIQUE INDEX "SubjectOffering_institutionId_academicYearId_subjectId_id_key"
ON "SubjectOffering" ("institutionId", "academicYearId", "subjectId", "id");

CREATE UNIQUE INDEX "SubjectOffering_id_institutionId_key"
ON "SubjectOffering" ("id", "institutionId");

CREATE INDEX "SubjectOffering_institutionId_academicYearId_idx"
ON "SubjectOffering" ("institutionId", "academicYearId");

CREATE INDEX "SubjectOffering_institutionId_subjectId_idx"
ON "SubjectOffering" ("institutionId", "subjectId");

-- ============================================================
-- STUDENT SUBJECT CHOICE
-- ============================================================

CREATE TABLE "StudentSubjectChoice" (
  "id" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "subjectOfferingId" UUID NOT NULL,
  "startLevel" VARCHAR(30) NOT NULL,
  "status" "StudentSubjectChoiceStatus" NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "StudentSubjectChoice_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "StudentSubjectChoice_institutionId_fkey"
    FOREIGN KEY ("institutionId")
    REFERENCES "Institution" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "StudentSubjectChoice_institutionId_studentId_fkey"
    FOREIGN KEY ("institutionId", "studentId")
    REFERENCES "Student" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "StudentSubjectChoice_institutionId_subjectOfferingId_fkey"
    FOREIGN KEY ("institutionId", "subjectOfferingId")
    REFERENCES "SubjectOffering" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "StudentSubjectChoice_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "StudentSubjectChoice_id_institutionId_key"
ON "StudentSubjectChoice" ("id", "institutionId");

CREATE UNIQUE INDEX "StudentSubjectChoice_active_unique"
ON "StudentSubjectChoice" ("institutionId", "studentId", "subjectOfferingId")
WHERE "status" = 'ACTIVE';

CREATE INDEX "StudentSubjectChoice_institutionId_studentId_status_idx"
ON "StudentSubjectChoice" ("institutionId", "studentId", "status");

CREATE INDEX "StudentSubjectChoice_institutionId_subjectOfferingId_idx"
ON "StudentSubjectChoice" ("institutionId", "subjectOfferingId");

CREATE INDEX "StudentSubjectChoice_institutionId_studentId_effectiveFrom_idx"
ON "StudentSubjectChoice" ("institutionId", "studentId", "effectiveFrom");

-- ============================================================
-- SCHEDULE PARTICIPANTS
-- ============================================================

CREATE TABLE "ScheduleClassParticipant" (
  "id" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "classId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScheduleClassParticipant_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "ScheduleClassParticipant_institutionId_fkey"
    FOREIGN KEY ("institutionId")
    REFERENCES "Institution" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "ScheduleClassParticipant_institutionId_scheduleId_fkey"
    FOREIGN KEY ("institutionId", "scheduleId")
    REFERENCES "Schedule" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "ScheduleClassParticipant_institutionId_classId_fkey"
    FOREIGN KEY ("institutionId", "classId")
    REFERENCES "Class" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScheduleClassParticipant_scheduleId_classId_key"
ON "ScheduleClassParticipant" ("scheduleId", "classId");

CREATE UNIQUE INDEX "ScheduleClassParticipant_id_institutionId_key"
ON "ScheduleClassParticipant" ("id", "institutionId");

CREATE INDEX "ScheduleClassParticipant_institutionId_scheduleId_idx"
ON "ScheduleClassParticipant" ("institutionId", "scheduleId");

CREATE INDEX "ScheduleClassParticipant_institutionId_classId_idx"
ON "ScheduleClassParticipant" ("institutionId", "classId");

CREATE TABLE "ScheduleStudentParticipant" (
  "id" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "action" "ScheduleStudentParticipantAction" NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "reason" VARCHAR(500),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ScheduleStudentParticipant_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "ScheduleStudentParticipant_institutionId_fkey"
    FOREIGN KEY ("institutionId")
    REFERENCES "Institution" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "ScheduleStudentParticipant_institutionId_scheduleId_fkey"
    FOREIGN KEY ("institutionId", "scheduleId")
    REFERENCES "Schedule" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "ScheduleStudentParticipant_institutionId_studentId_fkey"
    FOREIGN KEY ("institutionId", "studentId")
    REFERENCES "Student" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "ScheduleStudentParticipant_institutionId_createdByUserId_fkey"
    FOREIGN KEY ("institutionId", "createdByUserId")
    REFERENCES "User" ("institutionId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "ScheduleStudentParticipant_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "ScheduleStudentParticipant_id_institutionId_key"
ON "ScheduleStudentParticipant" ("id", "institutionId");

CREATE UNIQUE INDEX "ScheduleStudentParticipant_scheduleId_studentId_effectiveFrom_key"
ON "ScheduleStudentParticipant" ("scheduleId", "studentId", "effectiveFrom");

CREATE INDEX "ScheduleStudentParticipant_institutionId_scheduleId_idx"
ON "ScheduleStudentParticipant" ("institutionId", "scheduleId");

CREATE INDEX "ScheduleStudentParticipant_institutionId_studentId_idx"
ON "ScheduleStudentParticipant" ("institutionId", "studentId");

CREATE INDEX "ScheduleStudentParticipant_institutionId_scheduleId_studentId_idx"
ON "ScheduleStudentParticipant" ("institutionId", "scheduleId", "studentId");

-- ============================================================
-- SCHEDULE -> SUBJECT OFFERING INTEGRITY
-- ============================================================

ALTER TABLE "Schedule"
  ADD COLUMN "subjectOfferingId" UUID,
  ADD COLUMN "subjectOfferingInstitutionId" UUID;

ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_subjectOffering_pair_check"
  CHECK (
    ("subjectOfferingId" IS NULL AND "subjectOfferingInstitutionId" IS NULL)
    OR
    ("subjectOfferingId" IS NOT NULL
     AND "subjectOfferingInstitutionId" = "institutionId")
  );

ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_subjectOffering_context_fkey"
  FOREIGN KEY (
    "subjectOfferingInstitutionId",
    "academicYearId",
    "subjectId",
    "subjectOfferingId"
  )
  REFERENCES "SubjectOffering" (
    "institutionId",
    "academicYearId",
    "subjectId",
    "id"
  )
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "Schedule_institutionId_subjectOfferingId_idx"
ON "Schedule" ("institutionId", "subjectOfferingId");

-- ============================================================
-- ATTENDANCE SESSION HISTORICAL SNAPSHOT
-- ============================================================

ALTER TABLE "AttendanceSession"
  ADD COLUMN "subjectOfferingIdSnapshot" UUID;

-- Intentionally NO FK:
-- this is a historical snapshot identifier, not an operational relation.
