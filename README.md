# BSIT gradeview

A student progress portal built with React and Vite, with a Cloudflare Worker API and D1 database. All sign-ins use provisioned database accounts.

## Database setup

Follow [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) for local D1 testing, Cloudflare account login, hosted database creation, curriculum migrations, administrator/student account provisioning, and deployment.

```powershell
npm.cmd run db:migrate:local
npm.cmd run db:import-students -- --file .local/master-list/students.tsv --local
npm.cmd run cf:dev
```

Open Wrangler's printed URL, normally `http://127.0.0.1:8787`. Both `npm run dev` and `npm run cf:dev` run the persistent database application. Create a local administrator with `npm.cmd run db:account -- --local`. Sample accounts, displayed credentials, and browser-only sign-in have been removed.

For frontend hot reload on port 5173, leave `npm.cmd run cf:dev` running in one terminal and run `npm.cmd run dev:frontend` in another. Vite forwards `/api` requests to the backend on port 8787. Open `http://127.0.0.1:5173` in this workflow. Restart an already running Vite server after changing its configuration if it does not reload automatically.

## Student master list

See [STUDENT_IMPORT.md](STUDENT_IMPORT.md) for importing the 161 second-year BSIT students from `Names.pdf`. The reviewed TSV is kept privately in `.local/master-list/students.tsv`. Initial usernames are student IDs; initial passwords are exact surnames. A first-login password change is required and enforced by both the React interface and Worker API. Reimporting preserves chosen passwords and existing grades.

## Admin controls

Administrators can add students, change year levels and student status, add/edit course grades, and change course status. The academic calendar starts at **2026–2027, first semester**. **Advance to 2nd semester** moves to second semester; **Start next school year** moves to first semester of the following year. Grades are kept and year-level promotion remains manual. See [ADMIN_MANAGEMENT.md](ADMIN_MANAGEMENT.md) for instructions and required database migration.

## BSIT curriculum source

The curriculum is transcribed from `BSIT-2023-2024-PROGRESS-RECORD (1).docx`, revised 2023 and effective AY 2023–2024. `src/curriculum.json` preserves the source's course codes, descriptive titles, units, year/term grouping, and prerequisite text. The document's blank grade and evaluation fields do not provide student results or instructor names: initial records have no grades, status `Not taken`, and instructor `Unassigned`. Student identities come from the private master-list import.

| Year | First semester | Second semester | Summer | Total units |
| --- | --- | --- | --- | --- |
| First | 27 | 24 | 9 | 60 |
| Second | 27 | 27 | — | 54 |
| Third | 22 | 25 | — | 47 |
| Fourth | 24 | 12 | — | 36 |
| Total | | | | 197 |

There are 68 courses in nine terms. Both student and admin records support year and term selection, including first-year summer. Admin edits can set a sample instructor, grade, and status. Student course details and mobile cards show prerequisites.

## PDF exports

Each data table/list has an **Export PDF** button, including student courses, curriculum year summaries, the admin student directory, selected student progress records, the admin course directory, course progress summaries, and recent updates. Downloads follow the displayed search, status, year, semester, and sort order where applicable. Empty lists disable export. Student progress reports include the student number/name; grades keep two decimal places and ungraded records say `Pending`.

PDF reports include the BSIT gradeview title, report context, generation time in UTC+8, readable tables, repeated column headers, and page numbers. Wide tables use landscape A4; compact summaries use portrait A4. Exports download directly from the browser without a print dialog or external service. PDF libraries are loaded on demand. Run `npm.cmd run test:pdf` to verify generated PDF content and pagination.

Source wording is preserved, including PE 2's `PATHFIT 1` title, `PROFEL1` as the PROF ELEC 2 prerequisite, and SGP 6's title without a trailing number. The OJT row contains a completion requirement under the source heading `Labhours`; the UI labels it as an OJT requirement and retains the original column name. Prerequisites are displayed for reference, not enforced as enrollment rules. Curriculum effectivity is distinct from a student's academic year of attendance.

Includes the four-year curriculum, status filters, course/instructor search, course details, PDF export, a student profile, and a dark theme. Curriculum data comes from the supplied document. Edits are saved in D1 and the portal shows the signed-in student's own profile. Fonts load from Google Fonts when online, with system fallbacks.

## Login and administrator access

- Student login: `/#/student/login` — student ID and initial surname password; a personal password is required after first login.
- Admin login: `/#/admin/login` — your provisioned administrator email and password.
- Admin dashboard: `/#/admin/dashboard` after administrator sign-in.

Credentials are checked by the server and sessions use HttpOnly cookies. Hosted accounts are provisioned using `db:account -- --remote` or the master-list importer. Migration `0004_remove_demo_accounts.sql` removes only the explicitly identified legacy sample accounts and preserves imported students and personally provisioned administrators.

Student and administrator sign-in are separate pages with their own route, page component, credentials, and visual identity. There are no role tabs within either form. A footer link opens the other login page. Signing out returns to the matching role's login page.

The admin dashboard includes an academic overview, student search and pending-record filtering, a course directory, student progress details, and grade/status editing. Changes update dashboard summaries, the activity feed, and the matching student's records. Pending records have no final grade; passing grades range from 1.00 to 3.00 and failing grades are above 3.00 through 5.00.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Wrangler. On Windows PowerShell with restricted script execution, use `npm.cmd` in place of `npm`.

```sh
npm run build
npm run preview
```

The production build is generated in `dist/`. Use `npm ci` for repeat installs after the lockfile has been created. `npm run preview` serves the frontend build only; use `cf:dev` to include the API and D1. Run `npm run test:api` against a running, locally seeded `cf:dev` server to check login, permissions, persistence, and logout.

## Source

For production settings, database backup, release checks, deployment, monitoring, and recovery limitations, see [PRODUCTION.md](PRODUCTION.md). Run `npm run release:check` before deployment.

- `src/App.jsx`: React components, interactive filters, modal details, export, and theme state.
- `src/PortalApp.jsx`: role navigation and database sessions.
- `src/auth/LoginPage.jsx`: student and admin login pages.
- `src/admin/AdminDashboard.jsx`: dashboard, student directory, course directory, and record editing.
- `src/portal.css`: login and administrator layouts, including mobile cards.
- `src/data.js`: curriculum mapping and initial blank course records.
- `src/api.js`: same-origin database API client.
- `server/worker.js`: server authentication, student/admin permissions, and persistent record API.
- `migrations/`: D1 schema and imported BSIT curriculum.
- `scripts/create-account.mjs`: interactive account provisioning.
- `wrangler.jsonc`: Cloudflare Worker, static assets, and D1 binding.
- `style.css`: responsive visual styles.
- `vite.config.js`: Vite and React Fast Refresh configuration.
