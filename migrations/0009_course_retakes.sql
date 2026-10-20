ALTER TABLE progress_records ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1);
ALTER TABLE progress_records ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE progress_records ADD COLUMN operation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE record_audit ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 1;

CREATE TABLE course_attempts (
  student_no TEXT NOT NULL,
  course_code TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  grade REAL NOT NULL CHECK (grade > 3 AND grade <= 5),
  status TEXT NOT NULL CHECK (status = 'Failed'),
  instructor TEXT NOT NULL,
  academic_year_taken TEXT NOT NULL,
  semester_taken TEXT NOT NULL CHECK (semester_taken IN ('1','2','summer')),
  transfer_school TEXT NOT NULL DEFAULT '',
  archived_by TEXT NOT NULL REFERENCES accounts(id),
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_no, course_code, attempt_no),
  FOREIGN KEY (student_no, course_code) REFERENCES progress_records(student_no, course_code) ON DELETE CASCADE
);
