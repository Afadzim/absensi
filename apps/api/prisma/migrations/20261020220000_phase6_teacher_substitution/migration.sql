ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "TeacherSubstitution_valid_time_range"
  CHECK ("endTime" > "startTime");

ALTER TABLE "TeacherSubstitution"
  ADD CONSTRAINT "TeacherSubstitution_no_active_overlap"
  EXCLUDE USING gist (
    "institutionId" WITH =,
    "scheduleId" WITH =,
    "substitutionDate" WITH =,
    tsrange(
      "substitutionDate" + "startTime",
      "substitutionDate" + "endTime",
      '[)'
    ) WITH &&
  )
  WHERE ("status" IN ('PENDING', 'APPROVED'));
