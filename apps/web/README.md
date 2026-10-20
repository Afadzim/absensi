# Web application

The web workspace provides the authenticated master-data and schedule
management console. It uses the API session cookie and sends the CSRF header
for state-changing requests; authorization remains server-side. Schedule
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
