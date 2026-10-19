CREATE TABLE students (
  student_no TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  program TEXT NOT NULL DEFAULT 'BS Information Technology',
  year_level INTEGER NOT NULL CHECK (year_level BETWEEN 1 AND 4),
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE courses (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  year_level INTEGER NOT NULL CHECK (year_level BETWEEN 1 AND 4),
  semester TEXT NOT NULL CHECK (semester IN ('1','2','summer')),
  prerequisite TEXT NOT NULL,
  source_requirement_column TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('student','admin')),
  password_hash TEXT NOT NULL,
  student_no TEXT UNIQUE REFERENCES students(student_no),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role, identifier),
  CHECK ((role = 'student' AND student_no IS NOT NULL) OR (role = 'admin' AND student_no IS NULL))
);

CREATE TABLE progress_records (
  student_no TEXT NOT NULL REFERENCES students(student_no),
  course_code TEXT NOT NULL REFERENCES courses(code),
  grade REAL,
  status TEXT NOT NULL DEFAULT 'Not taken' CHECK (status IN ('Not taken','In progress','Incomplete','Passed','Failed')),
  instructor TEXT NOT NULL DEFAULT 'Unassigned',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(student_no, course_code),
  CHECK ((status = 'Passed' AND grade IS NOT NULL AND grade BETWEEN 1 AND 3)
    OR (status = 'Failed' AND grade IS NOT NULL AND grade > 3 AND grade <= 5)
    OR (status IN ('Not taken','In progress','Incomplete') AND grade IS NULL))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE record_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  student_no TEXT NOT NULL REFERENCES students(student_no),
  course_code TEXT NOT NULL REFERENCES courses(code),
  grade REAL,
  status TEXT NOT NULL,
  instructor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX record_audit_recent ON record_audit(created_at DESC);

CREATE TABLE login_attempts (
  bucket_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
