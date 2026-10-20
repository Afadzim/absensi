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
