# Admin student management and academic terms

The active term starts at **school year 2026–2027, first semester**, as requested. Apply migration `0005_admin_management.sql` before deploying the updated Worker.

## Add a student

1. Sign in as administrator.
2. Click **+ Add student**.
3. Enter the student ID, first/middle/last names, year level, student status, and optional email.
4. Click **Create student account**.

The student ID becomes the username. The exact last name becomes the initial password, and a personal password is required on first login. The account receives all 68 BSIT curriculum courses with blank grades. Existing student IDs cannot be reused.

## Change year level or student status

Open **Students → View record → Edit year / student status**. Select first through fourth year and one of **Active**, **Inactive**, or **Graduated**. Save the student.

Profile changes retain grades, instructor assignments, and the existing password. Student status describes enrollment; inactive and graduated students can still read their own academic records. It does not grant administrator permissions or delete their records.

## Add instructors

Open **Instructors → + Add instructor**, enter their full name, and save. You can also click **+ Add instructor** above the course grade table without leaving the student's record or losing draft grades.

Instructor names are stored independently of course assignments. Select an instructor from each row's dropdown, or choose **Unassigned**. Duplicate names are rejected regardless of case. Existing instructor names are imported into the directory by migration `0007_instructors.sql`; saved assignments are preserved. The API requires a registered instructor for new assignments.

## Reset a student password

Open **Students → View record → Reset password**. Review the student's name, ID, and exact saved last name, then click **Reset to last name**. Cancel closes the dialog without changing the account.

The reset replaces only that student's password with a bcrypt hash of their exact saved last name, preserving case, spaces, and accents. It signs out all their sessions and requires a new password at the next sign-in. Recent account-specific failed-login counts are cleared; IP limits stay in place. Administrator and other students' sessions, grades, profiles, and course assignments are kept. The action is logged with the administrator responsible.

A missing or unsupported saved last name blocks reset. A reset cannot target an administrator account, and students cannot invoke the endpoint. Passwords and password hashes are not returned by the reset API.

The directory supports filtering by these student statuses as well as pending course records. Student status is distinct from a course's Passed/Failed/Incomplete status.

## Add or edit grades and course status

Open a student's record and select the curriculum year and term. Edit grades, status, instructor, school year, and term taken directly in the course table.

- Enter a final grade from 1.00 through 5.00. A grade of 3.00 or better is passing.
- A newly entered grade automatically selects Passed or Failed; the server validates the grade/status combination.
- Not taken, In progress, and Incomplete records have no final grade.
- Set the instructor and the actual school year/term taken.
- Click **Save** on a row, or **Save all changes** to save every changed row. Tab moves between inputs; Enter in an input saves its row. Changes are stored in D1 and audited.

Drafts remain when switching year/term filters. The change count includes drafts in other terms, and Save all changes includes those rows too. Failed saves keep the entered values for retry. Discard changes restores saved values; leaving a student with unsaved changes prompts before discarding. PDF exports use saved records. On narrow screens, scroll the table horizontally to reach the remaining columns.

Historical records with no attendance year are labeled **Not recorded**. Their year is not inferred during migration. The model retains one result per curriculum course; editing a grade replaces that result. Separate repeated attempts are not modeled.

PDF progress reports include the school year and term taken in addition to the curriculum year/semester. The student's portal opens their assigned year and the active semester. It refreshes records and the active term when the tab regains focus.

## Advance the active term

The **Active school year & semester** panel appears in the admin workspace.

1. From **2026–2027 · 1st semester**, click **Advance to 2nd semester**.
2. Review the current and next terms in the dialog, then click **Advance term**.
3. From **2026–2027 · 2nd semester**, click **Start next school year** and confirm.
4. The active term becomes **2027–2028 · 1st semester**.

The same sequence continues for later school years. Term changes are saved to D1, recorded in recent updates, and protected against repeated/stale requests so two clicks cannot skip a term. No grade is cleared. Students are not automatically promoted: change their year levels individually when appropriate. Summer remains accessible through the curriculum filters and is not inserted into this first/second-semester advancement sequence.

Use **Set current term** to correct the active school year or semester. That action also preserves all student data and requires the latest calendar version.

## API

All these write endpoints require an administrator session and the correct request origin:

| Endpoint | Action |
| --- | --- |
| `POST /api/students` | Create student, account, and blank course records |
| `PATCH /api/students/:id` | Edit year level, student status, email |
| `PATCH /api/students/:id/records/:code` | Edit grade, course status, instructor, year/term taken |
| `GET /api/instructors` | List saved instructors (administrator only) |
| `POST /api/instructors` | Add a unique instructor name using `{ name }` |
| `POST /api/students/:id/reset-password` | Reset to the saved last name using `{ confirmStudentId: id }` |
| `POST /api/academic-term` | Advance to the next term using `expectedVersion` |
| `PATCH /api/academic-term` | Set current year/semester using `expectedVersion` |

The session response includes `academicTerm: { schoolYearStart, semester, version }`. New student responses also include `createdStudentId`.

## Database and deployment

Apply migration `0007_instructors.sql` **before deploying the updated Vercel API**. The migration creates the instructor directory and carries over names already used in records; it does not reset any student passwords. Use the backup and deployment steps in [VERCEL_SETUP.md](VERCEL_SETUP.md). The database-only Cloudflare Worker needs no code change for these features.

```powershell
npm.cmd run db:migrate:local
npm.cmd run db:migrate:remote
npm.cmd run cf:deploy
```

If Cloudflare returns authorization error **7403**, reauthorize Wrangler with `npm.cmd run cf:login` using the account that owns the configured `bsit-gradeview-db`, then retry the remote migration before deployment. Do not replace the database ID with a new database unless you intend to move the existing student records.

## Verification

```powershell
npm.cmd run test:admin
npm.cmd run test:api
npm.cmd run test:onboarding
npm.cmd run test:pdf
npm.cmd run build
```

`test:admin` starts a separate local Worker and database, applies the migrations there, and verifies creation, duplicate rejection, year/status editing, grade updates, student permissions, semester advancement, new-school-year rollover, and preservation of old grades. It does not advance the real database's calendar. Other integration tests use temporary local accounts and remove them afterward.
