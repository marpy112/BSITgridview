# BSIT gradeview: Cloudflare D1 setup

This project includes a Cloudflare Worker API and a D1 database. `wrangler.jsonc` is now bound to the hosted `bsit-gradeview-db`. The curriculum and the 161 students from `Names.pdf` have been imported, with first-login password changes required for the imported accounts. Reuse this database; the creation steps below are for a new account/project. Database import does not publish the Worker: complete Workers onboarding and deploy the current code before opening the site to students.

React/Vite builds the interface. A Worker serves that build and handles `/api/*`. The Worker accesses SQLite-based D1 through its private `DB` binding; the browser never receives database credentials. In database mode, login is checked on the server, students receive only their own records, and only administrators can edit grades.

## 1. Test the database locally

Open PowerShell in this project. Node.js 22.12 or newer is required. The commands use `npm.cmd` to work with your PowerShell execution policy.

```powershell
npm.cmd install
npm.cmd run db:migrate:local
npm.cmd run db:import-students -- --file .local/master-list/students.tsv --local
npm.cmd run db:account -- --local
npm.cmd run cf:dev
```

Open the URL printed by Wrangler, normally `http://127.0.0.1:8787`.

- Student: `http://127.0.0.1:8787/#/student/login` ? use a student ID and initial surname password from the imported master list. Students must choose a new password at first sign-in.
- Administrator: `http://127.0.0.1:8787/#/admin/login` ? use the account you provisioned locally.

All sign-ins are checked against D1. There are no sample accounts or displayed passwords. Admin record edits are saved to the selected database.

Local data persists in `.wrangler/state`. It is separate from the cloud database and is not uploaded by deployment. Both `npm.cmd run dev` and `npm.cmd run cf:dev` build and run the database-backed application. Stop and rerun development after frontend changes to rebuild the UI.

After binding a different database ID, Wrangler uses a separate local database for that ID. Apply local migrations and import students for the new binding if needed.

## 2. Connect your Cloudflare account

Create a Cloudflare account if you do not have one, then run:

```powershell
npm.cmd run cf:login
npx.cmd wrangler whoami
```

Complete the browser authorization opened by Wrangler. Do not paste your password or API token into the chat or application source.

## 3. Create the hosted D1 database

```powershell
npm.cmd run db:create
```

Cloudflare returns a `database_id` UUID. Copy that UUID and bind it to the Worker:

```powershell
npm.cmd run db:bind -- PASTE_YOUR_DATABASE_ID_HERE
```

This updates `wrangler.jsonc`, retaining binding name `DB` and database name `bsit-gradeview-db`. The database ID is an identifier, not a password. If `db:create` offers to update your configuration automatically, check `wrangler.jsonc`; running `db:bind` with the same ID is safe.

## 4. Create tables and import the actual BSIT curriculum

```powershell
npm.cmd run db:migrate:remote
```

The migrations create:

| Table | Purpose |
| --- | --- |
| `students` | Student number, name, program, year, email |
| `courses` | 68 courses, nine year/term groups, 197 units, source prerequisites |
| `accounts` | Student/admin identifiers and bcrypt password hashes |
| `progress_records` | Student-course grades, status, instructor |
| `sessions` | Hashed session tokens with eight-hour expiry |
| `record_audit` | Saved grade updates and the administrator responsible |
| `login_attempts` | Limits repeated sign-in attempts |

Schema/curriculum migrations do not create sample accounts. Import students separately from the private master list. Each newly provisioned student is assigned the 68-course curriculum with blank grades, `Not taken` status, and unassigned instructors.

Confirm the import:

```powershell
npx.cmd wrangler d1 execute bsit-gradeview-db --remote --command "SELECT COUNT(*) AS courses, SUM(units) AS units FROM courses;"
```

Expected: **68 courses, 197 units**. You can also inspect the database in the Cloudflare dashboard under **Storage & databases → D1 → bsit-gradeview-db**.

## 5. Create your administrator and student accounts

```powershell
npm.cmd run db:account -- --remote
```

Choose `admin`, enter your email, and enter a unique password when prompted. The password is hidden, must contain at least 12 characters, and is hashed before being sent to D1.

Run the same command again and choose `student`. Enter the student's number/iLearn number, first/middle/last name, year level, and optional email. The initial username is the student number and the initial password is the exact last name. Students must replace it on their first login. See [STUDENT_IMPORT.md](STUDENT_IMPORT.md) for the supplied master-list import.

You can use `--local` instead of `--remote` to create local test accounts. Account creation is insert-only: repeating an existing identifier does not reset its password. Required first-login password replacement is implemented. Password recovery, later voluntary password changes, self-registration, and account-management screens are not implemented yet.

## 6. Deploy the website and API together

This implementation verifies passwords with bcrypt at cost 12. Plan to use **Workers Paid** for these login endpoints: password hashing is expected to exceed the Workers Free 10 ms CPU allowance. Paid Workers have a higher CPU allowance; local development does not enforce the production CPU limit. If you need a strictly free deployment, adapt authentication to a managed identity provider before enabling hosted sign-in. See [Cloudflare's current CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

```powershell
npm.cmd run cf:deploy
```

Wrangler prints the deployed HTTPS URL, typically `https://bsit-gradeview.<your-subdomain>.workers.dev`. Open:

- `<your-url>/#/student/login`
- `<your-url>/#/admin/login`

Sign in with the accounts created in step 5. The application always uses the database API and never falls back to browser-only authentication.

No custom domain is required. You can attach one later in the Worker's Cloudflare settings.

## 7. Verify persistence and permissions

1. Sign in as administrator and open a student's record.
2. Save an instructor and a valid grade/status for a course.
3. Refresh: the change and recent update should remain.
4. Sign out and sign in as that student: the grade should match.
5. Student sessions cannot update records through the API or retrieve other students' records.
6. Export the filtered records to PDF and check the saved values.

Sessions use HttpOnly, SameSite cookies, with Secure enabled on HTTPS. Record updates validate role, origin, grade range, grade/status consistency, and course ownership on the server. Expired sessions and old login-limit entries are cleaned up on successful login. The current data model stores one result per curriculum course; repeated attempts and separate attendance years are future extensions.

## Troubleshooting

- **`npm.ps1 cannot be loaded`:** use `npm.cmd` and `npx.cmd` as shown above.
- **Missing tables:** run the migration command for the same target you are using (`local` or `remote`).
- **`5173/api/login` returns 404:** restart Vite to load `vite.config.js`, which proxies `/api` to port 8787, and keep `npm.cmd run cf:dev` running. Alternatively open `http://127.0.0.1:8787` directly. To run both servers, use `cf:dev` in one terminal and `dev:frontend` in another.
- **No students in the remote dashboard:** create student accounts using step 5 or import the private master list into the remote database.
- **Database binding errors:** confirm `wrangler.jsonc` contains the returned D1 ID and binding `DB`, then redeploy.
- **Local and hosted records differ:** local D1 and cloud D1 are separate databases. Use the deployed site for hosted records.
- **Deployment stops on the placeholder ID:** finish steps 2–4.
- **Runtime CPU-limit errors during password checks:** inspect Worker logs and your account's Worker CPU settings; bcrypt cost 12 is intentionally more expensive than a normal database query. Check current plan limits before enabling real student access.

## Official references

- [D1 getting started](https://developers.cloudflare.com/d1/get-started/)
- [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 migrations and commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
