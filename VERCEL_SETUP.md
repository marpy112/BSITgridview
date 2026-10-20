# Free Vercel API + Cloudflare D1

Frontend and Node API: https://bsitgridview.vercel.app

Administrator login: https://bsitgridview-git-main-makis-projects-c74e13c6.vercel.app/login/

`/login/` (also `/login`) opens the administrator form. The student login page does not advertise this link. The canonical production host also supports `/login/`, and existing `#/admin/login` bookmarks still work. The Vercel API permits same-origin writes from the exact production branch alias above; other preview origins remain denied. Vercel deployment protection, if enabled on the branch alias, is managed in Vercel separately from application sign-in.

Database gateway: https://bsit-gradeview.bsitibagridview.workers.dev

The Vercel Node function `api/index.js` runs the existing API, including bcrypt cost 12. An explicit local rewrite sends all `/api/:path*` requests to this function, including nested student, grade, password-reset, and retake endpoints. The Free Cloudflare Worker only executes database queries using the existing D1 binding. Accounts, password hashes, grades, sessions, origin checks, and atomic database writes are preserved. No database recreation, student import, password reset, or paid CPU setting is needed.

Both services have free usage limits. Vercel Hobby is for personal, non-commercial projects; confirm eligibility before using it for an institution's production service. Usage beyond the free allowances can interrupt service. This setup does not enable paid services or purchase a plan.

## 1. Deploy the database gateway

In PowerShell in this project:

```powershell
npm.cmd run cf:login
npx.cmd wrangler d1 migrations list bsit-gradeview-db --remote
npm.cmd run free:setup
npm.cmd run cf:deploy
```

`free:setup` generates a 256-bit server secret in the ignored file `.local/deployment/database-secret.txt` and uploads it as the Cloudflare secret `DATABASE_SECRET`. Re-running it reuses the saved secret. Keep that file private. Losing or replacing the file requires updating both providers to the same new value.

`cf:deploy` uses `wrangler.free.jsonc`, which has no paid CPU configuration and does not include the application or bcrypt. It uses the same existing database as `wrangler.jsonc`. The Worker exposes `/api/health` for readiness, and a secret-protected `/internal/database` endpoint for Vercel. Direct browser database requests and all other public routes are denied. Hourly cleanup removes expired sessions and throttle entries.

If migrations are pending, back up D1 before applying them. Keep exports private in the ignored `backups` directory. Do not create another database or reimport existing accounts.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
npx.cmd wrangler d1 export bsit-gradeview-db --remote --output backups/before-migration.sql
npm.cmd run db:migrate:remote
```

Use a new backup filename for each update, and apply migrations only after the export succeeds.

## 2. Set Vercel Production environment variables

Open the Vercel project → Settings → Environment Variables. Add these to **Production only**:

| Name | Value |
| --- | --- |
| `GRADEVIEW_DATABASE_URL` | `https://bsit-gradeview.bsitibagridview.workers.dev` |
| `GRADEVIEW_DATABASE_SECRET` | Exact contents of `.local/deployment/database-secret.txt` |

To copy the secret without displaying it in the terminal:

```powershell
Get-Content -Raw .local/deployment/database-secret.txt | Set-Clipboard
```

Paste into the Vercel secret value field. Never prefix these variable names with `VITE_`, commit them, or paste them into chat. A Cloudflare API token or OAuth credential is not needed on Vercel. Preview deployments do not get the production secret and cannot use the production API.

Keep Framework **Vite**, build command **npm run build**, output directory **dist**, production branch **main**, and Node.js **22.x or newer**. The Node API is deployed from the root `api` directory separately from the static build. `vercel.json` sets a 60-second function duration. Keep the local `/api/:path*` rewrite to `/api/index?__gradeview_path=:path*`; it passes the requested route to the Node function. Do not replace it with an external gateway rewrite. A standalone Vite function named `[...path].js` does not provide Next.js catch-all routing for nested paths.

Commit and push the implementation to `main` (or deploy it with the Vercel CLI), then wait for the production deployment. If you add or change environment variables after a deployment, redeploy so the function receives them. Setting variables alone does not update an existing deployment.

## 3. Verify

### Failed courses and retakes

Migration `0009_course_retakes.sql` adds attempt history and record versions. Back up D1 and apply pending migrations before deploying this version to Vercel. Existing grades stay in their current attempts; the migration does not start retakes or change student grades.

A failed course shows its retake in the next school year, in the same semester as the failed attempt. For example, a failure in **2026–2027 · 1st semester** schedules **2027–2028 · 1st semester**. Administrators select **Start retake** and confirm to archive the failed result and open a new attempt with no grade. The retake's school year and semester stay fixed; its instructor and result can be entered separately. Save any unsaved row changes first. For older failed records without attendance dates, save the actual school year and semester before starting the retake.

Repeated failures schedule another attempt in the following school year, keeping the same semester. Passing resolves the retake reminder while preserving previous failed attempts. Admin and student views show retakes across curriculum years, and course details and PDF exports include the history. A course counts once in GWA, using its current grade or the last graded attempt while a retake has no final grade. Conflicting edits are rejected so an older open page cannot overwrite a newer attempt.

### Transferee students and school of origin

Migration `0008_transfer_students.sql` adds student type, the previous school acronym, and the source-school field on each course record and its audit entry. Back up D1 and apply pending migrations before deploying this version to Vercel. Existing students default to regular students; existing grades and accounts are preserved.

In the admin portal, open **Students → View record → Edit student details**, select **Transferee**, and enter a previous school acronym such as **PUP**. The same fields are available when adding a student. In the grade table, select a grade and check **Transferred** on the relevant course. Its school acronym defaults to the student's previous school and can be changed per course. Leave current-school grades unmarked. Save the row or use **Save all changes**.

School acronyms are normalized to uppercase and limited to 30 characters. A transferred-school entry needs a final grade. A student with existing transferred-school entries cannot be changed back to regular until those annotations are removed; removing a school annotation preserves the numeric grade. Changing the default previous school does not rewrite the schools on saved course records.

The student view, course details, and PDF exports show the school of origin. Students can read their own records; only administrators can edit student type, grades, or schools. Transferred grades use the existing grade and unit calculations. The directory's **Transferees** filter helps locate these students.

When updating to the instructor-directory and student-reset features, first back up D1 and run `npm.cmd run db:migrate:remote` to apply `0007_instructors.sql`, then deploy the updated application to Vercel. The existing database gateway needs no redeployment. Do not push the updated API before applying its database migration.

```powershell
npm.cmd run production:smoke -- https://bsitgridview.vercel.app
```

Expected: homepage 200, database health 200, signed-out session 401, and signed-out nested API requests 401. These checks reveal no student information and make no student changes. A plain-text Vercel 404 for a nested API path means the request did not reach the Node function; deploy the updated routing configuration. Then test an existing administrator login, student first-login password change, a PDF download, and a refresh after saving a grade. Session cookies should be HttpOnly and Secure on HTTPS.

`npm run test:free` runs the existing API integration suite through the actual Vercel entry point and local database gateway, using an isolated database. It also checks denied gateway access, bounded payloads, preview isolation, and rollback after a failed transaction. No hosted student records are used by these tests.

Local development still uses `npm run cf:dev` with the full API and a local D1 database. `npm run cf:deploy:paid` retains the optional all-in-one Worker deployment and requires an appropriate paid plan; it is not used for this free setup.

References: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Cloudflare Free limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
