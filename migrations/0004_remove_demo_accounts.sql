-- Remove only the original, explicitly identified sample accounts.
-- Imported master-list student IDs and personally provisioned admins are untouched.
CREATE TABLE _legacy_demo_students AS
SELECT student_no FROM students WHERE
  (student_no='2024-00128' AND name='Jamie Anderson') OR
  (student_no='2024-00129' AND name='Alex Morgan') OR
  (student_no='2024-00130' AND name='Sam Rivera') OR
  (student_no='2024-00131' AND name='Taylor Santos') OR
  (student_no='2024-00132' AND name='Jordan Cruz') OR
  (student_no='2024-00133' AND name='Casey Reyes');

CREATE TABLE _legacy_demo_accounts AS
SELECT id FROM accounts WHERE
  student_no IN (SELECT student_no FROM _legacy_demo_students)
  OR (role='admin' AND identifier='admin@gradeview.demo');

DELETE FROM sessions WHERE account_id IN (SELECT id FROM _legacy_demo_accounts);
DELETE FROM record_audit WHERE actor_id IN (SELECT id FROM _legacy_demo_accounts)
  OR student_no IN (SELECT student_no FROM _legacy_demo_students);
DELETE FROM progress_records WHERE student_no IN (SELECT student_no FROM _legacy_demo_students);
DELETE FROM accounts WHERE id IN (SELECT id FROM _legacy_demo_accounts);
DELETE FROM students WHERE student_no IN (SELECT student_no FROM _legacy_demo_students);
DROP TABLE _legacy_demo_accounts;
DROP TABLE _legacy_demo_students;
