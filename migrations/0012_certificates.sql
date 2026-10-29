CREATE TABLE certificate_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  pdf_base64 TEXT NOT NULL CHECK(length(pdf_base64) <= 1400000),
  page_width REAL NOT NULL,
  page_height REAL NOT NULL,
  layout_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL
);

CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  verification_token TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL REFERENCES certificate_templates(id),
  recipient_name TEXT NOT NULL CHECK(length(recipient_name) BETWEEN 1 AND 180),
  issued_by TEXT NOT NULL REFERENCES accounts(id),
  issued_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES accounts(id)
);
CREATE INDEX certificates_recent ON certificates(issued_at DESC, id);
