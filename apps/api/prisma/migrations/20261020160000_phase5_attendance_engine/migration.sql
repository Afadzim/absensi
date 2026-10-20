-- Student administrative statuses for the same student may not overlap.
-- End dates are inclusive in the application, so use a half-open range here.
ALTER TABLE "StudentAdministrativeStatus"
  ADD CONSTRAINT "ex_student_admin_status_no_overlap"
  EXCLUDE USING gist (
    "institutionId" WITH =,
    "studentId" WITH =,
    daterange(
      "validFrom",
      COALESCE("validTo" + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  );
