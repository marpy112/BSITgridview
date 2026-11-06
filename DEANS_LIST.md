# Semester Dean’s List

Open **Admin → Dean’s List** and select a school year and semester. Year-level filtering uses the level on that semester’s enrollment record, rather than the student’s current profile.

A student qualifies only when:

- Every enrolled subject has a valid saved final grade for that exact school year and semester.
- Every individual grade is between **1.00 and 2.00**, inclusive. A qualifying GWA alone is insufficient.
- No subject in that semester has an INC.
- The student is not a transferee and has no transferred subject record in that semester.

The report uses imported `enrollment_source_records` to establish the complete subject roster. Missing or conflicting rosters, unmapped or duplicate subjects, inconsistent units, extra saved subjects, missing final grades, and ambiguous attempts are held under **Awaiting complete records**. Existing numeric grades are never substituted from another term. Previous failed attempts remain attached to their original term.

GWA is unit-weighted across every enrolled subject, including PE, NSTP, and guidance subjects. Grades are checked before rounding the displayed GWA. Changing the institution’s included-subject policy would require an explicit rule change.

**Print Dean’s List** and **Download PDF** fetch a fresh server report before producing output. Only qualified students in the selected year-level filter appear in the report. The report includes its term, criteria, completeness counts, GWA, and verification timestamp. These are generated reports; the feature does not change grades or save an award decision.

The API is `GET /api/deans-list?schoolYear=2026-2027&semester=1`, restricted to administrators. Semesters are `1`, `2`, and `summer`. It reads grades, earlier attempts, student profiles, and roster information in one transactional database batch; no schema migration is required.

Local development uses the local database. Rosters and grades imported only into production will not appear locally until they are separately imported into the local database.

Validation:

```text
node --test tests/deans-list.test.mjs tests/deans-list-api.test.mjs
npm run build:production
```
