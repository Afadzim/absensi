# Web application

The web workspace provides authenticated master-data, schedule, and attendance
consoles. It uses the API session cookie and sends the CSRF header for
state-changing requests; authorization remains server-side. Schedule
management is shown only to accounts with the owner-managed `schedule.*`
permissions, and reference selectors still require their corresponding
master-data read permissions.

From the repository root:

```powershell
Copy-Item apps\web\.env.example apps\web\.env.local
npm run --workspace=web dev
```

Set `NEXT_PUBLIC_API_BASE_URL` to the API origin before building for deployment.
That value is embedded in the browser bundle at build time. Configure the
matching web origin in the API's `CORS_ORIGINS` and serve production over HTTPS.

See [the API guide](../api/README.md) for the login flow, permission registry,
owner-managed account/role provisioning, and master-data endpoint details.

## PHASE 7 — PWA and offline attendance

The installable attendance console is available at `/attendance`. The service
worker caches the attendance app shell and same-origin static assets only; it
never caches API responses. Install and open the app online at least once so
the shell and assets are available offline. Production PWA use requires HTTPS.

Before going offline, sign in, open an eligible session with the correct
teacher segment, and load its student roster. Use **Muat roster gerbang**
online before using gate check-in offline. The browser stores this profile and
the relevant roster data in IndexedDB, scoped to the signed-in institution and
user. Offline actions are limited to student `HADIR` marks for a previously
loaded eligible roster and gate check-ins for the previously loaded student
list. Creating/opening sessions, handover, finalization, and administrative
status changes remain online-only.

Offline actions remain visibly local until the server acknowledges them.
Network, authentication, rate-limit, and server errors remain pending;
server-side rejections are retained as visible local conflicts and are not
silently retried or used to alter server attendance. The server remains the
authority for permissions, eligibility, and attendance state. Logging out
clears the account profile and cached roster data from this browser but
intentionally preserves queued events so they can be handled by the same
account later.

The institution timezone defaults to `Asia/Jakarta`. Keep API
`ATTENDANCE_TIME_ZONE` and web `NEXT_PUBLIC_ATTENDANCE_TIME_ZONE` aligned before
deploying; the web value is embedded at build time. The current configuration
is global, not per tenant.

## PHASE 8 — Calendar and reports

The `/reports` console provides the owner-managed academic calendar entry form
and the dashboard/reports view. It requires the corresponding server-managed
permissions: `academic_calendar.read`, `academic_calendar.create`, and
`attendance.report.read`. Sign in through the attendance console first if the
session is not active. The API remains authoritative for date completeness,
the official reporting cutoff, generated occurrence snapshots, and all
attendance calculations.
