ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Graduated'));
ALTER TABLE progress_records ADD COLUMN academic_year_taken TEXT NOT NULL DEFAULT '';
ALTER TABLE progress_records ADD COLUMN semester_taken TEXT NOT NULL DEFAULT '' CHECK (semester_taken IN ('','1','2','summer'));

CREATE TABLE academic_calendar (
  id INTEGER PRIMARY KEY CHECK (id=1),
  school_year_start INTEGER NOT NULL CHECK (school_year_start BETWEEN 2000 AND 2199),
  semester TEXT NOT NULL CHECK (semester IN ('1','2')),
  version INTEGER NOT NULL DEFAULT 0,
  operation_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO academic_calendar(id,school_year_start,semester) VALUES(1,2026,'1');

CREATE TABLE admin_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX admin_events_recent ON admin_events(created_at DESC);

ALTER TABLE record_audit ADD COLUMN academic_year_taken TEXT NOT NULL DEFAULT '';
ALTER TABLE record_audit ADD COLUMN semester_taken TEXT NOT NULL DEFAULT '';
