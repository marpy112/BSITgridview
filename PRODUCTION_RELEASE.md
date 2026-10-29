# Certificate release

This release includes JPEG certificate designs, placement controls, individual/bulk issuance, unique certificate IDs and QR tokens, public verification, student downloads/badges, and mobile bottom navigation. Preparation does not deploy the website or apply remote migrations.

## Local release gate

Use Node.js 22.12 or newer and the committed lockfile. On a fresh checkout, run `npm.cmd ci` first.

```powershell
npm.cmd audit --audit-level=high
npm.cmd run release:check
git diff --check
```

The release gate builds `dist`, checks security headers and routing, excludes private deployment inputs, checks server/script syntax, verifies certificate migration files and the bundled PDF worker, scans public assets for server-only values, and dry-runs both Cloudflare configurations. Nothing is published. PDF libraries load on demand; their larger chunks do not block initial portal loading.

## Upgrade the active database first

Check `GRADEVIEW_DATABASE_PROVIDER` in Vercel **Production** to select the correct path. Do not switch providers for this release or reimport student accounts. Keep database credentials in server environment variables only. Preview environments continue to reject production database access.

The read-only inspection on October 29, 2026 found:

| Configured database | Pending migrations |
| --- | --- |
| Turso | `0012_certificates.sql`, `0013_certificate_batches.sql`, `0014_student_certificates.sql` |
| Historical Cloudflare D1 | `0010` through `0014` |

Recheck before release; this records the inspection date and does not prove which provider a later Vercel deployment uses.

### Existing Turso installation

The existing ignored `.local/deployment/turso.env` supplies the same `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` used by the application.

```powershell
npm.cmd run turso:migrate -- --plan
```

Pause administrative writes and take a fresh private backup using the Turso Cloud CLI or the provider's backup tooling. For the Cloud CLI, replace the database name if needed and use a new filename:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
turso db shell bsit-gradeview .dump | Out-File -FilePath backups/before-certificates-YYYYMMDD-HHMMSS.sql -Encoding utf8
```

Check the command exit status and confirm that the export is complete and restorable before proceeding. The project ignores `backups/`, and `.vercelignore` excludes it from uploads. [Turso documents this dump command](https://docs.turso.tech/local-development).

```powershell
npm.cmd run turso:migrate -- --apply
npm.cmd run turso:migrate -- --plan
```

The upgrade requires the existing migration history through `0011`. It rechecks history inside a write transaction, applies the pending scripts and history together, verifies foreign keys, and rolls back an uncommitted failure. A second successful run makes no further schema changes. An interrupted or failed command should be followed by `--plan` to establish the saved state. No student names are automatically assigned to older certificates.

### Cloudflare D1 installation

Use this path only if Vercel Production still uses the Cloudflare provider. Take a fresh export before applying pending migrations. [Cloudflare migration guidance](https://developers.cloudflare.com/d1/reference/migrations/) describes the migration history.

```powershell
npx.cmd wrangler d1 migrations list bsit-gradeview-db --remote --config wrangler.free.jsonc
npx.cmd wrangler d1 export bsit-gradeview-db --remote --config wrangler.free.jsonc --output backups/before-certificates-YYYYMMDD-HHMMSS.sql
npm.cmd run db:migrate:remote
npm.cmd run cf:deploy:free
```

Proceed only after the backup succeeds. The gateway update is required for bounded certificate design uploads. Turso deployments do not use that gateway and do not require its deployment.

## Deploy the application

Keep the existing Vercel project, Production branch and database credentials. Commit all release changes, including the new certificate modules and migrations, then push to the configured Production branch or use the existing Vercel deployment workflow. `vercel.json` runs `npm run build:production`; remove any older dashboard build-command override. Keep output directory `dist` and the local API rewrite.

`APP_ORIGIN` should remain the stable public HTTPS hostname (default `https://bsitgridview.vercel.app`). Certificates issued or downloaded through the administrator branch alias still embed that public hostname in their QR codes. Local QR codes remain local; issue real certificates from Production. Preserve the hostname for previously downloaded certificates.

## Verify after deployment

These requests require no login and change no records:

```powershell
curl.exe -sS -o NUL -w "%{http_code}\n" https://bsitgridview.vercel.app/
curl.exe -sS -o NUL -w "%{http_code}\n" https://bsitgridview.vercel.app/api/health
curl.exe -sS -o NUL -w "%{http_code}\n" https://bsitgridview.vercel.app/api/session
curl.exe -sS -o NUL -w "%{http_code}\n" https://bsitgridview.vercel.app/api/my/certificates/summary
```

Expected statuses, in order: **200, 200, 401, 401**. Health checks require the certificate schema; missing migrations return 503.

Using existing accounts, confirm administrator and student sign-in. Upload an approved JPEG design, adjust the recipient/ID/QR positions, and issue an intended certificate to a selected student account. Confirm the student's badge and certificate view/PDF download, mobile bottom navigation, and QR verification from a signed-out device. For bulk issuance, confirm distinct printed IDs and verification links on different recipient pages. Link older unassigned certificates only after confirming the correct student ID.

## Recovery

If the application deployment fails after the additive migrations succeed, roll back the Vercel deployment; keep the new schema and certificate records. Diagnose before retrying. Do not reset the database, reuse an old student import, or change passwords to address a migration/deployment failure. Preserve current data and the private backup. Switching database providers does not copy newer writes between them.
