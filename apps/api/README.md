# API database setup

Requirements: Node.js `22.23.2`, npm `10.9.8`, and Docker Compose.

## Authentication

Configure `CORS_ORIGINS` as a comma-separated list of exact web application
origins (scheme, host, and optional port; no path or trailing slash). The
development default is `http://localhost:3000`; production requires an explicit
allowlist. Browser requests must include credentials.

`POST /api/v1/auth/login` accepts `institutionId` (UUID), `username`, and
`password`. Successful login sets secure, HttpOnly session and CSRF cookies and
returns the CSRF token. Send that token in `x-csrf-token` for state-changing
requests, including `POST /api/v1/auth/logout`. `GET /api/v1/auth/me` returns
the authenticated user's institution, teacher profile, roles, and permissions.

Attendance mutations require the matching permission:
`attendance.session.create`, `attendance.session.open`,
`attendance.session.handover`, `attendance.session.finalize`, or
`attendance.session.cancel`. The first administrator and all roles and
permissions are owner-managed; the application does not seed default accounts,
roles, or permissions.

## PHASE 3 — Master data

The management UI is served by the web workspace. Copy
`apps\web\.env.example` to `apps\web\.env.local` and set
`NEXT_PUBLIC_API_BASE_URL` to the API origin. Configure the same exact web
origin in the API's `CORS_ORIGINS`.

The API exposes tenant-scoped list/detail/create/update operations at
`/api/v1/master-data/{resource}` for:

- `academic-years`, `semesters`, `teachers`, `students`, `classes`;
- `student-enrollments`, `subjects`, `rooms`, `schedule-periods`;
- `subject-offerings`, `student-subject-choices`, and `users`.

List operations accept `page` (default `1`) and `pageSize` (default `50`, max
`100`) and return `data` plus `pagination`. Updates use `PATCH`. There are no
delete endpoints: master data and all referenced/history-bearing records are
preserved. Foreign-key and unique constraints reject invalid references and
duplicate codes. Tenant identity always comes from the authenticated session;
clients cannot set `institutionId`.

Every resource uses separate server-enforced permissions:
`master_data.{resource}.read`, `.create`, and `.update`, where resource codes
are `academic-year`, `semester`, `teacher`, `student`, `class`,
`student-enrollment`, `subject`, `room`, `schedule-period`,
`subject-offering`, `student-subject-choice`, and `user`. Create/update writes
an append-only `AuditLog` with actor, timestamp, entity, action, before/after
data, request metadata, and an optional `auditReason`. Password hashes and
plaintext passwords are never included in account responses or audit data.
User account updates can assign existing roles and link/unlink a teacher;
role and permission definitions remain owner-managed. The read-only role
lookup is `GET /api/v1/master-data/lookups/roles`, guarded by a user
read/create/update permission.

Permissions are deliberately not seeded. Before granting access, an owner
must register the codes above in `Permission` and associate only the desired
codes with existing owner-managed roles in `RolePermission`. For example, this
safe-to-repeat registration inserts codes without creating or granting roles:

```sql
INSERT INTO "Permission" ("id", "code")
SELECT gen_random_uuid(), code
FROM unnest(ARRAY[
  'master_data.academic-year.read',
  'master_data.academic-year.create',
  'master_data.academic-year.update',
  'master_data.semester.read',
  'master_data.semester.create',
  'master_data.semester.update',
  'master_data.teacher.read',
  'master_data.teacher.create',
  'master_data.teacher.update',
  'master_data.student.read',
  'master_data.student.create',
  'master_data.student.update',
  'master_data.class.read',
  'master_data.class.create',
  'master_data.class.update',
  'master_data.student-enrollment.read',
  'master_data.student-enrollment.create',
  'master_data.student-enrollment.update',
  'master_data.subject.read',
  'master_data.subject.create',
  'master_data.subject.update',
  'master_data.room.read',
  'master_data.room.create',
  'master_data.room.update',
  'master_data.schedule-period.read',
  'master_data.schedule-period.create',
  'master_data.schedule-period.update',
  'master_data.subject-offering.read',
  'master_data.subject-offering.create',
  'master_data.subject-offering.update',
  'master_data.student-subject-choice.read',
  'master_data.student-subject-choice.create',
  'master_data.student-subject-choice.update',
  'master_data.user.read',
  'master_data.user.create',
  'master_data.user.update'
]) AS codes(code)
ON CONFLICT ("code") DO NOTHING;
```

## PHASE 4 — Schedule engine

Schedules are managed at `/api/v1/schedules` with authenticated,
tenant-scoped list/detail/create/update operations. `GET` accepts `page`,
`pageSize`, `academicYearId`, `semesterId`, and ISO `dayOfWeek` filters
(Monday=1 through Sunday=7). `POST` creates a recurring schedule and
`PATCH /api/v1/schedules/{id}` updates it. There is no hard-delete endpoint.

Schedule request fields are `academicYearId`, `semesterId`, `dayOfWeek`,
`primaryTeacherId`, `classId`, `subjectId`, optional `subjectOfferingId`,
optional `roomId`, inclusive `startPeriodNumber`/`endPeriodNumber`, and
optional `classParticipantIds` for additional classes. Schedule periods in the
inclusive range must all exist. The semester must belong to the selected
academic year; every referenced record must belong to the authenticated
institution. Subject offerings must match the schedule's academic year and
subject. An ELECTIVE offering uses its active subject-choice roster and cannot
have additional class participants; REGULAR/GROUPING schedules use the main
class and configured additional classes.

An institution-scoped transaction lock serializes schedule writes before
conflict checks. Within the same tenant, academic year, semester, weekday, and
overlapping JP range, the API rejects conflicts for the primary teacher,
participant classes, and assigned room. Schedule updates apply to the
semester as a whole; attendance sessions already created retain their
schedule-time snapshots. Schedule changes and dated student INCLUDE/EXCLUDE
overrides are recorded in the append-only audit log. Override dates are
inclusive, and overlapping active overrides for one student and schedule are
rejected.

Schedule access uses owner-managed `schedule.read`, `schedule.create`, and
`schedule.update` permissions. No default grants are created. To create
schedules from the web console, grant the desired schedule permissions and
read permissions for the referenced academic years, semesters, teachers,
classes, subjects, subject offerings, and rooms. Student participant
overrides use the same schedule create/update permissions; students must also
be tenant-local.

Permission-code registration is safe to repeat and does not grant the codes
to any role:

```sql
INSERT INTO "Permission" ("id", "code")
SELECT gen_random_uuid(), code
FROM unnest(ARRAY[
  'schedule.read',
  'schedule.create',
  'schedule.update'
]) AS codes(code)
ON CONFLICT ("code") DO NOTHING;
```

Enrollment `validFrom`/`validTo` are inclusive calendar dates. A student may
have no class during a gap, but may not have overlapping enrollment ranges for
the same academic year. The API serializes enrollment changes per student and
PostgreSQL enforces the rule with an exclusion constraint. Enrollment history
is retained; an incorrect range must be corrected with an audited update.
Student-subject choice effective dates use the same inclusive date input format,
while their overlap semantics are unchanged by this phase.

Start the app workspaces from the repository root:

```powershell
Copy-Item apps\web\.env.example apps\web\.env.local
npm run --workspace=@absensi-madrasah/api dev
npm run --workspace=web dev
```

The first account, role definitions, permission registry/grants, and role
assignment are managed by the owner. There are no seeded/default credentials.

From the repository root, start PostgreSQL and create the API environment file:

```powershell
docker compose up -d postgres
Copy-Item apps\api\.env.example apps\api\.env
npm ci
```

Apply committed migrations to the local development database:

```powershell
npm exec --workspace=@absensi-madrasah/api -- prisma migrate deploy
npm exec --workspace=@absensi-madrasah/api -- prisma migrate status
npm exec --workspace=@absensi-madrasah/api -- prisma generate
```

The API test database must be named `absensi_madrasah_test`. Create it once:

```powershell
docker exec absensi-madrasah-postgres createdb -U absensi absensi_madrasah_test
$env:DATABASE_URL = "postgresql://absensi:absensi_dev_password@127.0.0.1:5432/absensi_madrasah_test?schema=public"
npm exec --workspace=@absensi-madrasah/api -- prisma migrate deploy
npm run --workspace=@absensi-madrasah/api test
```

Never point tests at the development or production database. The API test
database guard rejects any database URL that does not target
`absensi_madrasah_test`.

`Schedule` has an additional PostgreSQL composite foreign key in the v1.4
migration to ensure its subject offering matches its institution, academic year,
and subject. This physical constraint is intentionally stronger than the
two-column relation Prisma can represent; do not remove it when reviewing schema
diffs or creating migrations. Migration deployments use `migrate deploy` so
these committed PostgreSQL-specific constraints are preserved.
