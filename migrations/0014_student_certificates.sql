ALTER TABLE certificates ADD COLUMN student_no TEXT REFERENCES students(student_no);
CREATE INDEX certificates_student ON certificates(student_no, issued_at DESC, id);
