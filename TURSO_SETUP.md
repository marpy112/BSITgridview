# Move Gradeview to Turso Free

The Vercel frontend and Node API stay in the same project. The API can connect directly to Turso with `GRADEVIEW_DATABASE_PROVIDER=turso`. Cloudflare stays the default until the Production environment is deliberately changed. Existing SQLite constraints, password hashes, grade history, instructor choices, and student permissions are preserved.

## 1. Create the target

Create a free account at https://app.turso.tech and an empty database named `bsit-gradeview`. Use a **libSQL-compatible** database with foreign keys enabled. The importer checks foreign key enforcement before making changes. Stay on the Free plan with paid overages disabled.

Get its database URL and a read/write database authentication token. Save them in the ignored local file `.local/deployment/turso.env`:

```dotenv
TURSO_DATABASE_URL=libsql://your-database-your-account.turso.io
TURSO_AUTH_TOKEN=your-database-authentication-token
```

These are server credentials. They belong in this private file and Vercel's Production environment, never in frontend `VITE_` variables or Git.

## 2. Copy and verify existing data

Pause grade/profile edits for the final export and switch. Export a fresh copy of the existing D1 database into the ignored `backups` directory. Use a new filename each time; keep the export private. D1 SQL exports can succeed even while regular queries are limited, but only continue if the export finishes successfully.

```powershell
npx.cmd wrangler d1 export bsit-gradeview-db --remote --output backups/before-turso.sql
npm.cmd run turso:import -- --source backups/before-turso.sql --plan
npm.cmd run turso:import -- --source backups/before-turso.sql
```

The plan restores the export into an isolated private local SQLite file and checks integrity, foreign keys, and the current grade schema. Import refuses any target that already contains application tables. It creates tables, inserts data, and creates indexes in one transaction; any statement failure rolls the copy back. After import, every saved field is compared with the source using per-table checksums. Password hashes are copied exactly; no accounts are recreated and no passwords are reset. Old sessions and login throttles are intentionally left behind so users sign in again.

If a connection drops after the transaction may have committed, verify the target before trying another import:

```powershell
npm.cmd run turso:import -- --source backups/before-turso.sql --verify-only
```

Keep the source database and backup until the new database is verified and the website works. Do not use an earlier export if newer grades or profiles have been saved since it was made.

## 3. Switch Vercel Production

Only after successful verification, add these **Production** environment variables in Vercel:

| Name | Value |
| --- | --- |
| `GRADEVIEW_DATABASE_PROVIDER` | `turso` |
| `TURSO_DATABASE_URL` | Exact database URL from the private file |
| `TURSO_AUTH_TOKEN` | Exact authentication token from the private file |

Deploy the updated code and redeploy Production after setting the variables. Keep the existing local `/api/:path*` rewrite and Node.js 22 or newer. The existing Cloudflare variables may remain configured during the transition; Turso mode does not use them. Preview deployments still cannot access the production database.

Run `npm.cmd run production:smoke -- https://bsitgridview.vercel.app`, then sign in with the existing administrator password. Confirm the student count, save one intended change, reload it, and check a student login and PDF. The Cloudflare Worker and its daily row-read allowance are no longer in the application's request path once Turso mode is deployed.

Before any new Turso writes, reverting `GRADEVIEW_DATABASE_PROVIDER` to `cloudflare` and redeploying can return to the original database. Once Turso has accepted new grades or profile edits, copy those changes back before reverting; switching a connection does not synchronize databases.

## Validation and limits

`npm.cmd run test:turso` runs adapter/rollback/import verification tests and the existing API integration suite through the actual Vercel entry point with an isolated local libSQL database. It does not use hosted student data. `npm.cmd run test:free` continues to check the Cloudflare path.

Turso Free currently includes 5 GB storage, 500 million rows read monthly, and 10 million rows written monthly. It still has usage limits. See [official pricing](https://turso.tech/pricing) and the [TypeScript SDK reference](https://docs.turso.tech/sdk/ts/reference).
