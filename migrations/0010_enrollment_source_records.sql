-- Preserve source enrollment history, including legacy subjects and grade markers
-- that cannot be represented by the current curriculum's progress records.
CREATE TABLE enrollment_source_records (
  source TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('student','enrollment')),
  source_record_id TEXT NOT NULL,
  student_no TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, record_type, source_record_id)
);
CREATE INDEX enrollment_source_student ON enrollment_source_records(student_no, record_type);
