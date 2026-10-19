ALTER TABLE students ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN middle_name TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1));
ALTER TABLE accounts ADD COLUMN password_changed_at TEXT;
