CREATE TABLE certificate_batches (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES certificate_templates(id),
  issued_by TEXT NOT NULL REFERENCES accounts(id),
  issued_at TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL
);

ALTER TABLE certificates ADD COLUMN batch_id TEXT REFERENCES certificate_batches(id);
CREATE INDEX certificates_batch ON certificates(batch_id, id);
