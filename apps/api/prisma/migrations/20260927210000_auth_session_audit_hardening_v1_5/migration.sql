/*
  Migration: Authentication Session + Audit Hardening v1.5

  Scope:
  - Add AuthSession for server-side browser sessions.
  - Add security metadata to AuditLog.
  - Enforce AuditLog append-only at PostgreSQL level.

  IMPORTANT:
  - Do NOT modify Schedule -> SubjectOffering.
  - Do NOT rename v1.4 indexes.
  - v1.3/v1.4 physical hardening remains authoritative.
  - No RBAC seed data is inserted here.
*/

-- ============================================================
-- AUDIT LOG SECURITY METADATA
-- ============================================================

ALTER TABLE "AuditLog"
  ADD COLUMN "requestId" VARCHAR(100),
  ADD COLUMN "ipAddress" VARCHAR(45),
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "reason" TEXT;


-- ============================================================
-- AUTH SESSION
-- ============================================================

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,

    "sessionTokenHash" VARCHAR(128) NOT NULL,
    "csrfTokenHash" VARCHAR(128) NOT NULL,

    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    "createdIp" VARCHAR(45),
    "lastSeenIp" VARCHAR(45),
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey"
      PRIMARY KEY ("id")
);


-- ============================================================
-- AUTH SESSION INDEXES
-- ============================================================

CREATE UNIQUE INDEX "AuthSession_id_institutionId_key"
  ON "AuthSession" ("id", "institutionId");

CREATE UNIQUE INDEX "AuthSession_sessionTokenHash_key"
  ON "AuthSession" ("sessionTokenHash");

CREATE INDEX "AuthSession_institutionId_userId_revokedAt_idx"
  ON "AuthSession" ("institutionId", "userId", "revokedAt");

CREATE INDEX "AuthSession_institutionId_expiresAt_idx"
  ON "AuthSession" ("institutionId", "expiresAt");


-- ============================================================
-- TENANT-SAFE AUTH SESSION -> USER
-- ============================================================

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_institutionId_userId_fkey"
  FOREIGN KEY ("institutionId", "userId")
  REFERENCES "User" ("institutionId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;


-- ============================================================
-- AUDIT LOG APPEND-ONLY ENFORCEMENT
-- ============================================================

CREATE OR REPLACE FUNCTION "audit_log_append_only_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog is append-only: UPDATE and DELETE are prohibited';
END;
$$;

CREATE TRIGGER "trg_audit_log_append_only"
BEFORE UPDATE OR DELETE
ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION "audit_log_append_only_guard"();