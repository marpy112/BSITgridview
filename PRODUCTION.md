# Production release

The production target is a Cloudflare Worker serving the React build and a private D1 binding. `wrangler.jsonc` disables preview URLs, enables sanitized application error logs, gives bcrypt a 5-second CPU budget, and schedules hourly deletion of expired sessions and sign-in counters. Use Workers Paid for bcrypt authentication; no paid plan is purchased by these scripts.

## Verify the release

Use Node 22.12 or newer and install the lockfile exactly:

```powershell
npm.cmd ci
npm.cmd audit --audit-level=high
npm.cmd run release:check
```

The release check builds the client, applies migrations to a disposable local D1 database, tests student/admin permissions, onboarding, grade edits, semester rollover, request validation, login throttling, and PDF exports, then bundles a deployment dry run. It does not change the live school year or real student records. GitHub Actions runs these checks on pushes and pull requests without Cloudflare credentials. It does not deploy automatically.

## Publish

1. Finish Cloudflare Workers onboarding and configure a `workers.dev` subdomain in the dashboard. Confirm Workers Paid is enabled for the authentication CPU budget.
2. Sign in with `npm.cmd run cf:login`. Verify the intended account using `npx.cmd wrangler whoami`.
3. Before applying migrations, export a private database backup. The ignored `backups/` folder must never be shared or committed:

```powershell
New-Item -ItemType Directory -Force backups
npx.cmd wrangler d1 export bsit-gradeview-db --remote --output backups/before-release.sql
npm.cmd run db:migrate:remote
npm.cmd run cf:deploy
```

Existing students, passwords, grades, and the active term are preserved. New installations must provision their own administrator and import their private roster; see [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). Do not reimport students merely to deploy application changes.

4. Use the HTTPS address printed by Wrangler:

```powershell
npm.cmd run production:smoke -- https://bsit-gradeview.YOUR-SUBDOMAIN.workers.dev
```

The smoke check verifies the site, database readiness, unauthenticated API permissions, and security headers without signing in or reading student records. Then verify a real administrator sign-in and an authorized student's first-login password change in a browser. Check mobile course cards and PDF downloads. Ensure the production sign-in completes without CPU-limit errors.

## Operations

- Monitor `GET /api/health`: HTTP 200 with `{"status":"ok"}` means the active-calendar table is reachable. A failed readiness check returns 503. No account or student information is exposed.
- Inspect Worker logs for `api_error` events; request IDs correlate errors without logging names, grades, passwords, or SQL error text. Check Cron Trigger delivery in the dashboard.
- Store regular database exports in access-controlled storage. Before relying on backups, test restoration into a separate D1 database. Never restore over the live database without reviewing the data-loss implications.
- To roll back application code, use Cloudflare's deployment history or `npx.cmd wrangler rollback`. Worker rollback does not revert D1 migrations or recover grades. The new migration only adds indexes and is compatible with the preceding application.
- Keep the lockfile committed and run release checks before each deployment. Do not upload `.local`, `.wrangler`, `.env*`, private roster files, exports, or backups.

## Scope and remaining limits

Initial student passwords are surnames as requested and must be replaced on first login. Distribute initial credentials privately and require prompt activation. Recovery of forgotten passwords and voluntary later password changes do not have an application workflow yet; agree on a verified administrator-assisted recovery procedure before opening access. The system stores one result per curriculum course, so repeated course attempts are not separate transcript records.

The app blocks framing, restricts scripts to its own origin, prevents API caching, and limits request bodies to 4 KiB. Google Fonts is allowed by the style/font policy; system font fallbacks work when it is unavailable. Student records remain behind server-side permissions; robots directives are only an indexing preference.

Cloudflare references: [static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/), [Worker configuration and limits](https://developers.cloudflare.com/workers/wrangler/configuration/), [Worker logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
