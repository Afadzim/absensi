-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('OPEN', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceSegmentStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TeacherAttendanceStatus" AS ENUM ('HADIR', 'PARTIAL', 'DINAS', 'IZIN', 'SAKIT', 'ALPA');

-- CreateEnum
CREATE TYPE "StudentAttendanceStatus" AS ENUM ('HADIR', 'PENUGASAN', 'IZIN', 'SAKIT', 'ALPA');

-- CreateEnum
CREATE TYPE "TeacherAdministrativeStatusType" AS ENUM ('DINAS', 'IZIN', 'SAKIT');

-- CreateEnum
CREATE TYPE "StudentAdministrativeStatusType" AS ENUM ('IZIN', 'SAKIT', 'PENUGASAN');

-- CreateEnum
CREATE TYPE "SubstitutionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceAdjustmentTarget" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "ProcessedEventStatus" AS ENUM ('PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Institution" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Semester" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Semester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(30),
    "userId" UUID,
    "userInstitutionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "nisn" VARCHAR(30),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "level" VARCHAR(30),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentClassEnrollment" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentClassEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulePeriod" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "semesterId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "primaryTeacherId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "roomId" UUID,
    "roomInstitutionId" UUID,
    "startPeriodNumber" INTEGER NOT NULL,
    "endPeriodNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAdministrativeStatus" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "type" "TeacherAdministrativeStatusType" NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherAdministrativeStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAdministrativeStatus" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "type" "StudentAdministrativeStatusType" NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAdministrativeStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherSubstitution" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "substitutionDate" DATE NOT NULL,
    "originalTeacherId" UUID NOT NULL,
    "substituteTeacherId" UUID NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" UUID,
    "approvedByInstitutionId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "status" "SubstitutionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherSubstitution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "sessionDate" DATE NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'OPEN',
    "primaryTeacherIdSnapshot" UUID NOT NULL,
    "primaryTeacherCodeSnapshot" VARCHAR(50) NOT NULL,
    "primaryTeacherNameSnapshot" VARCHAR(200) NOT NULL,
    "classIdSnapshot" UUID NOT NULL,
    "classCodeSnapshot" VARCHAR(50) NOT NULL,
    "classNameSnapshot" VARCHAR(100) NOT NULL,
    "subjectIdSnapshot" UUID NOT NULL,
    "subjectCodeSnapshot" VARCHAR(50) NOT NULL,
    "subjectNameSnapshot" VARCHAR(150) NOT NULL,
    "roomIdSnapshot" UUID,
    "roomCodeSnapshot" VARCHAR(50),
    "roomNameSnapshot" VARCHAR(100),
    "startPeriodNumberSnapshot" INTEGER NOT NULL,
    "endPeriodNumberSnapshot" INTEGER NOT NULL,
    "startTimeSnapshot" TIME(0) NOT NULL,
    "endTimeSnapshot" TIME(0) NOT NULL,
    "scheduledJpSnapshot" DECIMAL(10,4) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSessionSegment" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "attendanceSessionId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "status" "AttendanceSegmentStatus" NOT NULL DEFAULT 'OPEN',
    "allocatedJp" DECIMAL(12,8) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceSessionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAttendance" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "attendanceSessionId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "teacherCodeSnapshot" VARCHAR(50) NOT NULL,
    "teacherNameSnapshot" VARCHAR(200) NOT NULL,
    "assignedJp" DECIMAL(10,4) NOT NULL,
    "allocatedJp" DECIMAL(12,8) NOT NULL,
    "status" "TeacherAttendanceStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAttendance" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "attendanceSessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "studentCodeSnapshot" VARCHAR(50) NOT NULL,
    "studentNameSnapshot" VARCHAR(200) NOT NULL,
    "classIdSnapshot" UUID NOT NULL,
    "classCodeSnapshot" VARCHAR(50) NOT NULL,
    "classNameSnapshot" VARCHAR(100) NOT NULL,
    "status" "StudentAttendanceStatus" NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvent" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "eventAt" TIMESTAMPTZ(3) NOT NULL,
    "eventDate" DATE NOT NULL,
    "clientEventId" VARCHAR(100),
    "source" VARCHAR(50),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAdjustment" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "attendanceSessionId" UUID,
    "attendanceSessionInstitutionId" UUID,
    "targetType" "AttendanceAdjustmentTarget" NOT NULL,
    "studentAttendanceId" UUID,
    "studentAttendanceInstitutionId" UUID,
    "teacherAttendanceId" UUID,
    "teacherAttendanceInstitutionId" UUID,
    "beforeStatus" VARCHAR(30) NOT NULL,
    "afterStatus" VARCHAR(30) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "actorUserId" UUID,
    "actorInstitutionId" UUID,
    "action" VARCHAR(50) NOT NULL,
    "entity" VARCHAR(100) NOT NULL,
    "entityId" UUID NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "recipient" VARCHAR(200) NOT NULL,
    "notificationType" VARCHAR(50) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" VARCHAR(150),
    "payload" JSONB,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "clientEventId" VARCHAR(100) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "status" "ProcessedEventStatus" NOT NULL DEFAULT 'PROCESSED',
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_code_key" ON "Institution"("code");

-- CreateIndex
CREATE INDEX "AcademicYear_institutionId_idx" ON "AcademicYear"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_institutionId_code_key" ON "AcademicYear"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_id_institutionId_key" ON "AcademicYear"("id", "institutionId");

-- CreateIndex
CREATE INDEX "Semester_institutionId_academicYearId_idx" ON "Semester"("institutionId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "Semester_academicYearId_code_key" ON "Semester"("academicYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Semester_id_institutionId_key" ON "Semester"("id", "institutionId");

-- CreateIndex
CREATE INDEX "User_institutionId_idx" ON "User"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_institutionId_username_key" ON "User"("institutionId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_institutionId_key" ON "User"("id", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "Teacher_institutionId_userId_idx" ON "Teacher"("institutionId", "userId");

-- CreateIndex
CREATE INDEX "Teacher_institutionId_idx" ON "Teacher"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_institutionId_code_key" ON "Teacher"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_id_institutionId_key" ON "Teacher"("id", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_userInstitutionId_userId_key" ON "Teacher"("userInstitutionId", "userId");

-- CreateIndex
CREATE INDEX "Student_institutionId_idx" ON "Student"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_institutionId_code_key" ON "Student"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Student_id_institutionId_key" ON "Student"("id", "institutionId");

-- CreateIndex
CREATE INDEX "Class_institutionId_idx" ON "Class"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_institutionId_code_key" ON "Class"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Class_id_institutionId_key" ON "Class"("id", "institutionId");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_institutionId_studentId_validFrom_va_idx" ON "StudentClassEnrollment"("institutionId", "studentId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_institutionId_classId_validFrom_vali_idx" ON "StudentClassEnrollment"("institutionId", "classId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_institutionId_academicYearId_idx" ON "StudentClassEnrollment"("institutionId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentClassEnrollment_id_institutionId_key" ON "StudentClassEnrollment"("id", "institutionId");

-- CreateIndex
CREATE INDEX "Subject_institutionId_idx" ON "Subject"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_institutionId_code_key" ON "Subject"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_id_institutionId_key" ON "Subject"("id", "institutionId");

-- CreateIndex
CREATE INDEX "Room_institutionId_idx" ON "Room"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_institutionId_code_key" ON "Room"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_id_institutionId_key" ON "Room"("id", "institutionId");

-- CreateIndex
CREATE INDEX "SchedulePeriod_institutionId_idx" ON "SchedulePeriod"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePeriod_institutionId_periodNumber_key" ON "SchedulePeriod"("institutionId", "periodNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePeriod_id_institutionId_key" ON "SchedulePeriod"("id", "institutionId");

-- CreateIndex
CREATE INDEX "Schedule_institutionId_dayOfWeek_idx" ON "Schedule"("institutionId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Schedule_institutionId_primaryTeacherId_dayOfWeek_idx" ON "Schedule"("institutionId", "primaryTeacherId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Schedule_institutionId_classId_dayOfWeek_idx" ON "Schedule"("institutionId", "classId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Schedule_institutionId_subjectId_dayOfWeek_idx" ON "Schedule"("institutionId", "subjectId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Schedule_institutionId_startPeriodNumber_endPeriodNumber_idx" ON "Schedule"("institutionId", "startPeriodNumber", "endPeriodNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_id_institutionId_key" ON "Schedule"("id", "institutionId");

-- CreateIndex
CREATE INDEX "TeacherAdministrativeStatus_institutionId_teacherId_validFr_idx" ON "TeacherAdministrativeStatus"("institutionId", "teacherId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAdministrativeStatus_id_institutionId_key" ON "TeacherAdministrativeStatus"("id", "institutionId");

-- CreateIndex
CREATE INDEX "StudentAdministrativeStatus_institutionId_studentId_validFr_idx" ON "StudentAdministrativeStatus"("institutionId", "studentId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAdministrativeStatus_id_institutionId_key" ON "StudentAdministrativeStatus"("id", "institutionId");

-- CreateIndex
CREATE INDEX "TeacherSubstitution_institutionId_scheduleId_substitutionDa_idx" ON "TeacherSubstitution"("institutionId", "scheduleId", "substitutionDate");

-- CreateIndex
CREATE INDEX "TeacherSubstitution_institutionId_substituteTeacherId_subst_idx" ON "TeacherSubstitution"("institutionId", "substituteTeacherId", "substitutionDate");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherSubstitution_id_institutionId_key" ON "TeacherSubstitution"("id", "institutionId");

-- CreateIndex
CREATE INDEX "AttendanceSession_institutionId_sessionDate_status_idx" ON "AttendanceSession"("institutionId", "sessionDate", "status");

-- CreateIndex
CREATE INDEX "AttendanceSession_institutionId_scheduleId_sessionDate_idx" ON "AttendanceSession"("institutionId", "scheduleId", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_scheduleId_sessionDate_key" ON "AttendanceSession"("scheduleId", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_id_institutionId_key" ON "AttendanceSession"("id", "institutionId");

-- CreateIndex
CREATE INDEX "AttendanceSessionSegment_institutionId_attendanceSessionId__idx" ON "AttendanceSessionSegment"("institutionId", "attendanceSessionId", "teacherId");

-- CreateIndex
CREATE INDEX "AttendanceSessionSegment_attendanceSessionId_teacherId_idx" ON "AttendanceSessionSegment"("attendanceSessionId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSessionSegment_id_institutionId_key" ON "AttendanceSessionSegment"("id", "institutionId");

-- CreateIndex
CREATE INDEX "TeacherAttendance_institutionId_teacherId_attendanceDate_idx" ON "TeacherAttendance"("institutionId", "teacherId", "attendanceDate");

-- CreateIndex
CREATE INDEX "TeacherAttendance_institutionId_teacherId_scheduleId_idx" ON "TeacherAttendance"("institutionId", "teacherId", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAttendance_attendanceSessionId_teacherId_key" ON "TeacherAttendance"("attendanceSessionId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAttendance_id_institutionId_key" ON "TeacherAttendance"("id", "institutionId");

-- CreateIndex
CREATE INDEX "StudentAttendance_institutionId_studentId_recordedAt_idx" ON "StudentAttendance"("institutionId", "studentId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAttendance_attendanceSessionId_studentId_key" ON "StudentAttendance"("attendanceSessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAttendance_id_institutionId_key" ON "StudentAttendance"("id", "institutionId");

-- CreateIndex
CREATE INDEX "GateEvent_institutionId_studentId_eventDate_idx" ON "GateEvent"("institutionId", "studentId", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "GateEvent_id_institutionId_key" ON "GateEvent"("id", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "GateEvent_institutionId_clientEventId_key" ON "GateEvent"("institutionId", "clientEventId");

-- CreateIndex
CREATE INDEX "AttendanceAdjustment_institutionId_attendanceSessionId_crea_idx" ON "AttendanceAdjustment"("institutionId", "attendanceSessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceAdjustment_id_institutionId_key" ON "AttendanceAdjustment"("id", "institutionId");

-- CreateIndex
CREATE INDEX "AuditLog_institutionId_entity_entityId_idx" ON "AuditLog"("institutionId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_institutionId_actorUserId_createdAt_idx" ON "AuditLog"("institutionId", "actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_id_institutionId_key" ON "AuditLog"("id", "institutionId");

-- CreateIndex
CREATE INDEX "NotificationLog_institutionId_notificationType_createdAt_idx" ON "NotificationLog"("institutionId", "notificationType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_id_institutionId_key" ON "NotificationLog"("id", "institutionId");

-- CreateIndex
CREATE INDEX "ProcessedEvent_institutionId_eventType_processedAt_idx" ON "ProcessedEvent"("institutionId", "eventType", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_id_institutionId_key" ON "ProcessedEvent"("id", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_institutionId_clientEventId_key" ON "ProcessedEvent"("institutionId", "clientEventId");

-- AddForeignKey
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Semester" ADD CONSTRAINT "Semester_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Semester" ADD CONSTRAINT "Semester_institutionId_academicYearId_fkey" FOREIGN KEY ("institutionId", "academicYearId") REFERENCES "AcademicYear"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userInstitutionId_userId_fkey" FOREIGN KEY ("userInstitutionId", "userId") REFERENCES "User"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_institutionId_studentId_fkey" FOREIGN KEY ("institutionId", "studentId") REFERENCES "Student"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_institutionId_classId_fkey" FOREIGN KEY ("institutionId", "classId") REFERENCES "Class"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_institutionId_academicYearId_fkey" FOREIGN KEY ("institutionId", "academicYearId") REFERENCES "AcademicYear"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulePeriod" ADD CONSTRAINT "SchedulePeriod_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_academicYearId_fkey" FOREIGN KEY ("institutionId", "academicYearId") REFERENCES "AcademicYear"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_semesterId_fkey" FOREIGN KEY ("institutionId", "semesterId") REFERENCES "Semester"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_primaryTeacherId_fkey" FOREIGN KEY ("institutionId", "primaryTeacherId") REFERENCES "Teacher"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_classId_fkey" FOREIGN KEY ("institutionId", "classId") REFERENCES "Class"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_subjectId_fkey" FOREIGN KEY ("institutionId", "subjectId") REFERENCES "Subject"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_roomInstitutionId_roomId_fkey" FOREIGN KEY ("roomInstitutionId", "roomId") REFERENCES "Room"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_startPeriodNumber_fkey" FOREIGN KEY ("institutionId", "startPeriodNumber") REFERENCES "SchedulePeriod"("institutionId", "periodNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_institutionId_endPeriodNumber_fkey" FOREIGN KEY ("institutionId", "endPeriodNumber") REFERENCES "SchedulePeriod"("institutionId", "periodNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAdministrativeStatus" ADD CONSTRAINT "TeacherAdministrativeStatus_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAdministrativeStatus" ADD CONSTRAINT "TeacherAdministrativeStatus_institutionId_teacherId_fkey" FOREIGN KEY ("institutionId", "teacherId") REFERENCES "Teacher"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAdministrativeStatus" ADD CONSTRAINT "TeacherAdministrativeStatus_institutionId_createdById_fkey" FOREIGN KEY ("institutionId", "createdById") REFERENCES "User"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAdministrativeStatus" ADD CONSTRAINT "StudentAdministrativeStatus_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAdministrativeStatus" ADD CONSTRAINT "StudentAdministrativeStatus_institutionId_studentId_fkey" FOREIGN KEY ("institutionId", "studentId") REFERENCES "Student"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAdministrativeStatus" ADD CONSTRAINT "StudentAdministrativeStatus_institutionId_createdById_fkey" FOREIGN KEY ("institutionId", "createdById") REFERENCES "User"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_institutionId_scheduleId_fkey" FOREIGN KEY ("institutionId", "scheduleId") REFERENCES "Schedule"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_institutionId_originalTeacherId_fkey" FOREIGN KEY ("institutionId", "originalTeacherId") REFERENCES "Teacher"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_institutionId_substituteTeacherId_fkey" FOREIGN KEY ("institutionId", "substituteTeacherId") REFERENCES "Teacher"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_approvedByInstitutionId_approvedById_fkey" FOREIGN KEY ("approvedByInstitutionId", "approvedById") REFERENCES "User"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_institutionId_scheduleId_fkey" FOREIGN KEY ("institutionId", "scheduleId") REFERENCES "Schedule"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSessionSegment" ADD CONSTRAINT "AttendanceSessionSegment_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSessionSegment" ADD CONSTRAINT "AttendanceSessionSegment_institutionId_attendanceSessionId_fkey" FOREIGN KEY ("institutionId", "attendanceSessionId") REFERENCES "AttendanceSession"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSessionSegment" ADD CONSTRAINT "AttendanceSessionSegment_institutionId_teacherId_fkey" FOREIGN KEY ("institutionId", "teacherId") REFERENCES "Teacher"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAttendance" ADD CONSTRAINT "TeacherAttendance_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAttendance" ADD CONSTRAINT "TeacherAttendance_institutionId_attendanceSessionId_fkey" FOREIGN KEY ("institutionId", "attendanceSessionId") REFERENCES "AttendanceSession"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAttendance" ADD CONSTRAINT "TeacherAttendance_institutionId_scheduleId_fkey" FOREIGN KEY ("institutionId", "scheduleId") REFERENCES "Schedule"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAttendance" ADD CONSTRAINT "TeacherAttendance_institutionId_teacherId_fkey" FOREIGN KEY ("institutionId", "teacherId") REFERENCES "Teacher"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendance" ADD CONSTRAINT "StudentAttendance_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendance" ADD CONSTRAINT "StudentAttendance_institutionId_attendanceSessionId_fkey" FOREIGN KEY ("institutionId", "attendanceSessionId") REFERENCES "AttendanceSession"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendance" ADD CONSTRAINT "StudentAttendance_institutionId_studentId_fkey" FOREIGN KEY ("institutionId", "studentId") REFERENCES "Student"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_institutionId_studentId_fkey" FOREIGN KEY ("institutionId", "studentId") REFERENCES "Student"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_attendanceSessionInstitutionId_attend_fkey" FOREIGN KEY ("attendanceSessionInstitutionId", "attendanceSessionId") REFERENCES "AttendanceSession"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_studentAttendanceInstitutionId_studen_fkey" FOREIGN KEY ("studentAttendanceInstitutionId", "studentAttendanceId") REFERENCES "StudentAttendance"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_teacherAttendanceInstitutionId_teache_fkey" FOREIGN KEY ("teacherAttendanceInstitutionId", "teacherAttendanceId") REFERENCES "TeacherAttendance"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_institutionId_createdById_fkey" FOREIGN KEY ("institutionId", "createdById") REFERENCES "User"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorInstitutionId_actorUserId_fkey" FOREIGN KEY ("actorInstitutionId", "actorUserId") REFERENCES "User"("institutionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedEvent" ADD CONSTRAINT "ProcessedEvent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- ABSENSI MADRASAH â€” PHYSICAL MIGRATION SQL v1.3
-- PostgreSQL 16+
-- Companion to schema.prisma.design-v1.3
-- ============================================================
-- Purpose:
--   1. Database CHECK invariants that are not represented directly
--      by Prisma schema.
--   2. Partial unique index for exactly one OPEN segment/session.
--   3. PostgreSQL exclusion constraint for closed segment overlap.
--   4. Explicitly documents transaction/concurrency invariants.
--
-- IMPORTANT:
--   Cross-row allocation validation and handover atomicity are enforced
--   by the API transaction protocol, not by a simple CHECK constraint.
-- ============================================================
-- ------------------------------------------------------------
-- 0. Required PostgreSQL extension for exclusion constraint.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- 1. CHECK constraints â€” schedule/time.
-- ------------------------------------------------------------
ALTER TABLE "SchedulePeriod"
  ADD CONSTRAINT "ck_schedule_period_time_order"
  CHECK ("endTime" > "startTime");

ALTER TABLE "Schedule"
  ADD CONSTRAINT "ck_schedule_period_range"
  CHECK ("startPeriodNumber" <= "endPeriodNumber");

ALTER TABLE "Schedule"
  ADD CONSTRAINT "ck_schedule_day_of_week"
  CHECK ("dayOfWeek" BETWEEN 1 AND 7);

-- ------------------------------------------------------------
-- 2. CHECK constraints â€” administrative validity.
-- ------------------------------------------------------------
ALTER TABLE "TeacherAdministrativeStatus"
  ADD CONSTRAINT "ck_teacher_admin_status_date_range"
  CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE "StudentAdministrativeStatus"
  ADD CONSTRAINT "ck_student_admin_status_date_range"
  CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

-- ------------------------------------------------------------
-- 3. CHECK constraints â€” substitution.
-- ------------------------------------------------------------
ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "ck_teacher_substitution_time_order"
  CHECK ("endTime" > "startTime");

ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "ck_teacher_substitution_distinct_teachers"
  CHECK ("originalTeacherId" <> "substituteTeacherId");

-- ------------------------------------------------------------
-- 4. CHECK constraints â€” attendance session lifecycle.
-- ------------------------------------------------------------
ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "ck_attendance_session_scheduled_jp_positive"
  CHECK ("scheduledJpSnapshot" > 0);

ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "ck_attendance_session_finalized_timestamp"
  CHECK (
    "status" <> 'FINALIZED'
    OR "finalizedAt" IS NOT NULL
  );

ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "ck_attendance_session_cancelled_timestamp"
  CHECK (
    "status" <> 'CANCELLED'
    OR "cancelledAt" IS NOT NULL
  );

-- A session cannot simultaneously be finalized and cancelled.
ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "ck_attendance_session_terminal_state_exclusive"
  CHECK (
    NOT ("status" = 'FINALIZED' AND "cancelledAt" IS NOT NULL)
    AND
    NOT ("status" = 'CANCELLED' AND "finalizedAt" IS NOT NULL)
  );

-- ------------------------------------------------------------
-- 5. CHECK constraints â€” session segment lifecycle.
-- ------------------------------------------------------------
ALTER TABLE "AttendanceSessionSegment"
  ADD CONSTRAINT "ck_attendance_segment_allocated_jp_nonnegative"
  CHECK ("allocatedJp" >= 0);

ALTER TABLE "AttendanceSessionSegment"
  ADD CONSTRAINT "ck_attendance_segment_interval_order"
  CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

ALTER TABLE "AttendanceSessionSegment"
  ADD CONSTRAINT "ck_attendance_segment_status_interval"
  CHECK (
    ("status" = 'OPEN' AND "endedAt" IS NULL)
    OR
    ("status" = 'CLOSED' AND "endedAt" IS NOT NULL)
  );

-- ------------------------------------------------------------
-- 6. CHECK constraints â€” teacher attendance.
-- ------------------------------------------------------------
ALTER TABLE "TeacherAttendance"
  ADD CONSTRAINT "ck_teacher_attendance_assigned_jp_nonnegative"
  CHECK ("assignedJp" >= 0);

ALTER TABLE "TeacherAttendance"
  ADD CONSTRAINT "ck_teacher_attendance_allocated_jp_nonnegative"
  CHECK ("allocatedJp" >= 0);

-- ------------------------------------------------------------
-- 7. CHECK constraints â€” attendance adjustment target integrity.
-- ------------------------------------------------------------
ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_attendance_adjustment_target"
  CHECK (
    (
      "targetType" = 'TEACHER'
      AND "teacherAttendanceId" IS NOT NULL
      AND "studentAttendanceId" IS NULL
    )
    OR
    (
      "targetType" = 'STUDENT'
      AND "studentAttendanceId" IS NOT NULL
      AND "teacherAttendanceId" IS NULL
    )
  );


-- Teacher -> User optional relation.
ALTER TABLE "Teacher"
  ADD CONSTRAINT "ck_teacher_user_fk_pair"
  CHECK (
    ("userId" IS NULL AND "userInstitutionId" IS NULL)
    OR
    ("userId" IS NOT NULL AND "userInstitutionId" IS NOT NULL)
  );

ALTER TABLE "Teacher"
  ADD CONSTRAINT "ck_teacher_user_same_institution"
  CHECK (
    "userInstitutionId" IS NULL
    OR "userInstitutionId" = "institutionId"
  );

-- ------------------------------------------------------------
-- 8. CHECK constraints â€” optional tenant-safe composite FK pairs.
--
-- Prisma optional composite relations require every scalar in the
-- relation's fields tuple to be nullable. The nullable tenant-key
-- pairs below preserve the database-level composite FK:
--
--   optionalInstitutionId + optionalEntityId
--          -> institutionId + id
--
-- The pair must be either completely NULL or completely populated,
-- and when populated it must belong to the current row's tenant.
-- ------------------------------------------------------------

ALTER TABLE "Schedule"
  ADD CONSTRAINT "ck_schedule_room_fk_pair"
  CHECK (
    ("roomId" IS NULL AND "roomInstitutionId" IS NULL)
    OR
    ("roomId" IS NOT NULL AND "roomInstitutionId" IS NOT NULL)
  );

ALTER TABLE "Schedule"
  ADD CONSTRAINT "ck_schedule_room_same_institution"
  CHECK (
    "roomInstitutionId" IS NULL
    OR "roomInstitutionId" = "institutionId"
  );

ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "ck_teacher_substitution_approved_by_fk_pair"
  CHECK (
    ("approvedById" IS NULL AND "approvedByInstitutionId" IS NULL)
    OR
    ("approvedById" IS NOT NULL AND "approvedByInstitutionId" IS NOT NULL)
  );

ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "ck_teacher_substitution_approved_by_same_institution"
  CHECK (
    "approvedByInstitutionId" IS NULL
    OR "approvedByInstitutionId" = "institutionId"
  );

ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "ck_teacher_substitution_approval_state"
  CHECK (
    "status" <> 'APPROVED'
    OR (
      "approvedById" IS NOT NULL
      AND "approvedByInstitutionId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
    )
  );

ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_adjustment_session_fk_pair"
  CHECK (
    ("attendanceSessionId" IS NULL AND "attendanceSessionInstitutionId" IS NULL)
    OR
    ("attendanceSessionId" IS NOT NULL AND "attendanceSessionInstitutionId" IS NOT NULL)
  );

ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_adjustment_session_same_institution"
  CHECK (
    "attendanceSessionInstitutionId" IS NULL
    OR "attendanceSessionInstitutionId" = "institutionId"
  );

ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_adjustment_student_attendance_fk_pair"
  CHECK (
    ("studentAttendanceId" IS NULL AND "studentAttendanceInstitutionId" IS NULL)
    OR
    ("studentAttendanceId" IS NOT NULL AND "studentAttendanceInstitutionId" IS NOT NULL)
  );

ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_adjustment_student_attendance_same_institution"
  CHECK (
    "studentAttendanceInstitutionId" IS NULL
    OR "studentAttendanceInstitutionId" = "institutionId"
  );

ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_adjustment_teacher_attendance_fk_pair"
  CHECK (
    ("teacherAttendanceId" IS NULL AND "teacherAttendanceInstitutionId" IS NULL)
    OR
    ("teacherAttendanceId" IS NOT NULL AND "teacherAttendanceInstitutionId" IS NOT NULL)
  );

ALTER TABLE "AttendanceAdjustment"
  ADD CONSTRAINT "ck_adjustment_teacher_attendance_same_institution"
  CHECK (
    "teacherAttendanceInstitutionId" IS NULL
    OR "teacherAttendanceInstitutionId" = "institutionId"
  );

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "ck_audit_actor_fk_pair"
  CHECK (
    ("actorUserId" IS NULL AND "actorInstitutionId" IS NULL)
    OR
    ("actorUserId" IS NOT NULL AND "actorInstitutionId" IS NOT NULL)
  );

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "ck_audit_actor_same_institution"
  CHECK (
    "actorInstitutionId" IS NULL
    OR "actorInstitutionId" = "institutionId"
  );

-- ------------------------------------------------------------
-- 9. One OPEN segment per AttendanceSession.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX "ux_attendance_session_one_open_segment"
  ON "AttendanceSessionSegment" ("attendanceSessionId")
  WHERE "status" = 'OPEN';

-- ------------------------------------------------------------
-- 10. Segment interval overlap protection.
--
-- Every segment participates in the exclusion constraint. An OPEN segment
-- is represented as an interval ending at PostgreSQL infinity. This prevents
-- an OPEN segment from overlapping a CLOSED segment and vice versa. The
-- half-open range [start, end) allows a clean handover at exactly the
-- previous segment's end timestamp.
-- ------------------------------------------------------------
ALTER TABLE "AttendanceSessionSegment"
  ADD CONSTRAINT "ex_attendance_session_segment_no_overlap"
  EXCLUDE USING gist (
    "attendanceSessionId" WITH =,
    tstzrange(
      "startedAt",
      COALESCE("endedAt", 'infinity'::timestamptz),
      '[)'
    ) WITH &&
  );

-- ------------------------------------------------------------
-- 11. Helpful physical indexes for tenant-safe composite FK lookups.
-- Most are already produced by @@unique([id, institutionId]).
-- These are intentionally NOT duplicated here.
-- ------------------------------------------------------------
-- ============================================================
-- TRANSACTION-LEVEL INVARIANTS (API REQUIRED)
-- ============================================================
-- The following cannot safely be reduced to ordinary row CHECKs:
--
-- A. TeacherAttendance.attendanceDate = AttendanceSession.sessionDate
-- B. AttendanceAdjustment target session = target attendance session
-- C. SUM(segment.allocatedJp) <= AttendanceSession.scheduledJpSnapshot
-- D. Handover atomicity: CLOSE old segment + OPEN new segment
-- E. Allocation recalculation across SchedulePeriod intersections
-- F. Finalization/cancellation must serialize with segment mutation
--
-- Required mutation protocol:
--
-- BEGIN;
-- SELECT attendance_session FOR UPDATE;
-- validate current lifecycle state;
-- validate actor/substitution/tenant;
-- mutate segment(s);
-- recalculate allocation using full precision;
-- assert total allocation <= scheduledJpSnapshot;
-- assert interval/continuity rules;
-- update TeacherAttendance projection;
--
--
-- For finalization/cancellation/correction, the same AttendanceSession row
-- is the serialization root. The service must never calculate an aggregate
-- allocation before acquiring this lock.
-- ============================================================

