CREATE TYPE "AcademicCalendarDayType" AS ENUM (
  'EFFECTIVE',
  'NATIONAL_HOLIDAY',
  'SPECIAL_HOLIDAY'
);

CREATE TYPE "ScheduleOccurrenceStatus" AS ENUM ('EFFECTIVE');

CREATE TABLE "AcademicCalendarDay" (
  "id" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "calendarDate" DATE NOT NULL,
  "dayType" "AcademicCalendarDayType" NOT NULL,
  "label" VARCHAR(200),
  "createdById" UUID NOT NULL,
  "generationCompletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AcademicCalendarDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleOccurrence" (
  "id" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "academicCalendarDayId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "occurrenceDate" DATE NOT NULL,
  "status" "ScheduleOccurrenceStatus" NOT NULL DEFAULT 'EFFECTIVE',
  "primaryTeacherIdSnapshot" UUID NOT NULL,
  "primaryTeacherCodeSnapshot" VARCHAR(50) NOT NULL,
  "primaryTeacherNameSnapshot" VARCHAR(200) NOT NULL,
  "classIdSnapshot" UUID NOT NULL,
  "classCodeSnapshot" VARCHAR(50) NOT NULL,
  "classNameSnapshot" VARCHAR(100) NOT NULL,
  "subjectIdSnapshot" UUID NOT NULL,
  "subjectCodeSnapshot" VARCHAR(50) NOT NULL,
  "subjectNameSnapshot" VARCHAR(150) NOT NULL,
  "startPeriodNumberSnapshot" INTEGER NOT NULL,
  "endPeriodNumberSnapshot" INTEGER NOT NULL,
  "startTimeSnapshot" TIME(0) NOT NULL,
  "endTimeSnapshot" TIME(0) NOT NULL,
  "scheduledJpSnapshot" DECIMAL(10,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScheduleOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademicCalendarDay_institutionId_calendarDate_key"
  ON "AcademicCalendarDay"("institutionId", "calendarDate");
CREATE UNIQUE INDEX "AcademicCalendarDay_id_institutionId_key"
  ON "AcademicCalendarDay"("id", "institutionId");
CREATE INDEX "AcademicCalendarDay_institutionId_dayType_calendarDate_idx"
  ON "AcademicCalendarDay"("institutionId", "dayType", "calendarDate");

CREATE UNIQUE INDEX "ScheduleOccurrence_institutionId_scheduleId_occurrenceDate_key"
  ON "ScheduleOccurrence"("institutionId", "scheduleId", "occurrenceDate");
CREATE UNIQUE INDEX "ScheduleOccurrence_id_institutionId_key"
  ON "ScheduleOccurrence"("id", "institutionId");
CREATE INDEX "ScheduleOccurrence_institutionId_occurrenceDate_status_idx"
  ON "ScheduleOccurrence"("institutionId", "occurrenceDate", "status");
CREATE INDEX "ScheduleOccurrence_institutionId_primaryTeacherIdSnapshot_occurrenceDate_idx"
  ON "ScheduleOccurrence"("institutionId", "primaryTeacherIdSnapshot", "occurrenceDate");
CREATE INDEX "ScheduleOccurrence_institutionId_classIdSnapshot_occurrenceDate_idx"
  ON "ScheduleOccurrence"("institutionId", "classIdSnapshot", "occurrenceDate");
CREATE INDEX "ScheduleOccurrence_institutionId_subjectIdSnapshot_occurrenceDate_idx"
  ON "ScheduleOccurrence"("institutionId", "subjectIdSnapshot", "occurrenceDate");

ALTER TABLE "AcademicCalendarDay"
  ADD CONSTRAINT "AcademicCalendarDay_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicCalendarDay"
  ADD CONSTRAINT "AcademicCalendarDay_institutionId_createdById_fkey"
  FOREIGN KEY ("institutionId", "createdById") REFERENCES "User"("institutionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduleOccurrence"
  ADD CONSTRAINT "ScheduleOccurrence_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleOccurrence"
  ADD CONSTRAINT "ScheduleOccurrence_academicCalendarDayId_institutionId_fkey"
  FOREIGN KEY ("academicCalendarDayId", "institutionId")
  REFERENCES "AcademicCalendarDay"("id", "institutionId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleOccurrence"
  ADD CONSTRAINT "ScheduleOccurrence_institutionId_scheduleId_fkey"
  FOREIGN KEY ("institutionId", "scheduleId") REFERENCES "Schedule"("institutionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
