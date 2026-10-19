# Student master list and first-login passwords

The supplied `E:\Names.pdf` contains **161 second-year BSIT students** over four scanned pages. The private, reviewed transcription is `.local/master-list/students.tsv`; the PDF page images and OCR working files are in the same directory. `.local/` is ignored by Git and is never imported into the React application bundle.

Source rows per page: **39, 44, 44, 34**. All 161 student IDs were checked against the page images/OCR. Names preserve multiword surnames, accents, missing middle names, and suffixes. Student IDs and names are retained as printed, including names split across lines.

## Initial credentials

- Username: exact student ID from the master list.
- Initial password: exact `last_name` field, case-sensitive, including spaces, hyphens, and accents. The supplied list uses uppercase surnames.
- First login: a password-change screen is required before progress records can be accessed.
- New password: at least 12 characters, no more than 72 UTF-8 bytes, and different from the initial password.

The initial surname is hashed with bcrypt; plaintext passwords are not written into account SQL or stored in D1. The surname remains part of the normal student profile. Do not place the private TSV or PDF into `public/`, `src/`, or an unprotected download link.

## Import commands

First apply the onboarding migration:

```powershell
npm.cmd run db:migrate:local
npm.cmd run db:migrate:remote
```

Validate a list without writing data:

```powershell
npm.cmd run db:import-students -- --file .local/master-list/students.tsv --local --dry-run
```

Import into the selected database:

```powershell
npm.cmd run db:import-students -- --file .local/master-list/students.tsv --local
npm.cmd run db:import-students -- --file .local/master-list/students.tsv --remote
```

The importer preserves existing student IDs, grades, instructor assignments, passwords, and password-change completion flags. Matching students have their name components and year level synchronized from the list. New accounts receive the initial surname password and `must_change_password=1`. Reimporting never resets a student's chosen password. Each student is assigned the 68-course curriculum with blank results for new records.

New manually provisioned student accounts (`db:account`) also use the supplied last name as the initial password and require a first-login change. Administrator provisioning keeps its separate password prompt. Legacy sample accounts have been removed; automated tests create isolated temporary accounts and delete them afterward.

## Password-change enforcement

`POST /api/login` and `GET /api/session` return `mustChangePassword: true` and no student/course data for a restricted account. The interface always displays the change form, even if the user edits the URL or refreshes. Server routes enforce the same restriction.

`POST /api/change-password` validates the new password and confirmation, replaces the stored bcrypt hash, clears the flag, records the change timestamp, invalidates all previous sessions for that account, and issues a fresh session cookie. Afterward the initial surname no longer works and subsequent logins go directly to the progress record.

## Verification

```powershell
npm.cmd run cf:dev
```

In a second terminal:

```powershell
npm.cmd run test:onboarding
npm.cmd run test:api
```

Onboarding tests use a synthetic student against local D1 only. They test restricted sessions, blocked access before changing the password, short/mismatched passwords, old-session revocation, rejection of the old password, and persistence of the replacement password.

## Hosted application

Importing D1 data does not deploy the Worker. Publish the updated password-change flow using:

```powershell
npm.cmd run cf:deploy
```

If Cloudflare asks you to set up a `workers.dev` subdomain, complete the Workers onboarding in your Cloudflare dashboard, then rerun deployment. Do not use an older Worker implementation for newly imported student accounts, since the updated Worker enforces the mandatory password change.
