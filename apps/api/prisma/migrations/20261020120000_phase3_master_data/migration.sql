CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "StudentClassEnrollment"
ADD CONSTRAINT "StudentClassEnrollment_single_active_class_excl"
EXCLUDE USING gist (
  "institutionId" WITH =,
  "studentId" WITH =,
  "academicYearId" WITH =,
  daterange("validFrom", "validTo", '[]') WITH &&
);
