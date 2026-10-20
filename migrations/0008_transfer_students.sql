ALTER TABLE students ADD COLUMN is_transferee INTEGER NOT NULL DEFAULT 0 CHECK (is_transferee IN (0,1));
ALTER TABLE students ADD COLUMN previous_school TEXT NOT NULL DEFAULT '';
ALTER TABLE progress_records ADD COLUMN transfer_school TEXT NOT NULL DEFAULT '';
ALTER TABLE record_audit ADD COLUMN transfer_school TEXT NOT NULL DEFAULT '';
