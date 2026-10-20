CREATE TABLE instructors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Keep instructors already used in saved records available in the new dropdown.
INSERT INTO instructors(id, name, name_key)
SELECT lower(hex(randomblob(16))), name, lower(name)
FROM (
  SELECT trim(instructor) AS name FROM progress_records
  WHERE trim(instructor) <> '' AND lower(trim(instructor)) <> 'unassigned'
  GROUP BY lower(trim(instructor))
);
