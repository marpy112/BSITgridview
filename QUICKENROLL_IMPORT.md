# Import BSIT enrollment records

The importer accepts a private `gradeview-quickenroll-v1` JSON export containing the BSIT directory and the enrollment grade reports read through an authorized enrollment-system session. Keep exports, reviews and backups in `.local/`; never commit student records or account credentials.

Deploy the updated API before applying a large import. Student snapshots reconstruct untouched curriculum defaults locally and retrieve saved records with a single indexed lookup per student/course. The Vercel API streams gzip JSON when accepted, keeping large directories usable without changing the browser's data format.

Preview the import against the configured Grade View Turso database:

```powershell
npm run db:import-quickenroll -- --source .local/quickenroll-extract/bsit-data.json --plan
```

Apply the reviewed import:

```powershell
npm run db:import-quickenroll -- --source .local/quickenroll-extract/bsit-data.json --apply
```

The importer takes a fresh private backup under a database write lock, then updates profiles, initializes curriculum records, imports instructor names, saves compatible grades and failed attempts, and records an audit entry for each imported grade. It verifies the result before committing the transaction. Existing passwords, first-login flags, transfer data, saved grades and retake history are preserved. New student accounts use the exact normalized surname for initial sign-in and require a password change.

Subject mapping uses reviewed titles and units because legacy codes can refer to different subjects. A numeric removal grade supersedes the original final grade. Decimal grades retain their source precision. Incomplete grades remain incomplete; zeroes are treated as pending placeholders. Dropped or unrecognized markers and conflicting source entries are retained for review. Students without an ID or year level are archived without inventing application identities.

Migration `0010_enrollment_source_records.sql` stores every extracted student and enrollment entry, including its original grade strings and legacy subject codes. The current curriculum displays compatible records; the complete source history is retained separately in the database and the private export. The migration is applied by the importer when necessary and is supported by the Turso backup/migration tools. Reports in the private import directory list saved-grade conflicts, unsupported markers, and subjects without a current curriculum match.

Run `node --test tests/quickenroll.test.mjs tests/turso.test.mjs` to check subject mapping, grade interpretation, password preservation, repeat imports and transaction rollback.
