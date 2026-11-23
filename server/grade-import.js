import { gradeImportBodyBytes, gradeImportMaxRows, gradeImportTerm, interpretSourceGrade } from '../shared/grade-import.js';
import { normalizeSchoolYear } from '../shared/deans-list.js';
import { mapSourceCourse } from '../shared/source-courses.js';

const badRequest = message => Object.assign(new Error(message), { status: 400 });
const key = (studentNo, code) => `${studentNo}\0${code}`;
const identity = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}|[^\p{L}\p{N}]/gu, '');
const isBsit = value => ['bsit', 'bsinformationtechnology', 'bachelorofscienceininformationtechnology'].includes(identity(value));
const textLimits = { studentNo: 80, subjectCode: 60, title: 240, units: 20, finalGrade: 30, removalGrade: 30, lastName: 160, program: 120 };

function validateInput(input) {
  const term = gradeImportTerm(input.schoolYear, input.semester);
  if (!term) throw badRequest('Choose a valid school year and semester.');
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > gradeImportMaxRows) throw badRequest('Provide between 1 and 5,000 grade rows.');
  let lastRow = 1;
  const rows = input.rows.map(entry => {
    if (!entry || !Number.isInteger(entry.row) || entry.row <= lastRow || entry.row > gradeImportMaxRows + 10) throw badRequest('Workbook row numbers are invalid.');
    lastRow = entry.row;
    const row = { row: entry.row, invalidCell: entry.invalidCell === true };
    for (const [field, limit] of Object.entries(textLimits)) {
      const value = entry[field] ?? '';
      if (typeof value !== 'string' || value.length > limit) throw badRequest(`Row ${entry.row} has an invalid field.`);
      row[field] = value.trim();
    }
    return { ...row, code: mapSourceCourse(row, { verifyCode: true }) };
  });
  return { ...term, rows };
}

async function readRecords(db, rows) {
  const ids = [...new Set(rows.map(row => row.studentNo).filter(Boolean))];
  const pairs = rows.filter(row => row.code && row.studentNo).map(row => [row.studentNo, row.code]);
  const [students, records] = await db.batch([
    db.prepare('SELECT student_no,last_name,program FROM students WHERE student_no IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)),
    db.prepare(`SELECT DISTINCT json_extract(j.value,'$[0]') AS student_no, c.code AS course_code,
      p.grade,p.status,p.academic_year_taken,p.semester_taken,p.transfer_school,p.attempt_no,p.version
      FROM json_each(?) j JOIN courses c ON c.code=json_extract(j.value,'$[1]')
      LEFT JOIN progress_records p ON p.student_no=json_extract(j.value,'$[0]') AND p.course_code=c.code`).bind(JSON.stringify(pairs)),
  ]);
  return {
    students: new Map(students.results.map(student => [student.student_no, student])),
    records: new Map(records.results.map(record => [key(record.student_no, record.course_code), record])),
  };
}

async function importPlan(db, input, digest) {
  const { schoolYear, semester, rows } = validateInput(input);
  const { students, records } = await readRecords(db, rows);
  const occurrences = new Map();
  for (const row of rows) {
    const id = key(row.studentNo, row.code);
    if (row.studentNo && row.code) occurrences.set(id, (occurrences.get(id) || 0) + 1);
  }
  const changes = [], issues = [];
  let pending = 0, unchanged = 0, replacements = 0;
  for (const row of rows) {
    const issue = message => issues.push({ row: row.row, studentNo: row.studentNo, course: row.subjectCode, message });
    if (row.invalidCell) { issue('Replace formulas or Excel errors with grade values.'); continue; }
    const student = students.get(row.studentNo);
    if (!student) { issue('Student ID is missing or does not match an existing student.'); continue; }
    if (!isBsit(student.program) || (row.program && !isBsit(row.program))) { issue('The student and workbook program must be BSIT.'); continue; }
    if (row.lastName && student.last_name && identity(row.lastName) !== identity(student.last_name)) { issue('Last name does not match the student ID in Grade View.'); continue; }
    const id = key(row.studentNo, row.code);
    const record = records.get(id);
    if (!record) { issue('Subject code, title, and units could not be matched to the BSIT curriculum.'); continue; }
    if (occurrences.get(id) > 1) { issue('This student and subject appear more than once in the file.'); continue; }
    const grade = interpretSourceGrade(row.finalGrade.toUpperCase(), row.removalGrade.toUpperCase());
    if (grade.review === 'unsupported_grade_marker') { issue(`Grade marker “${row.removalGrade || row.finalGrade}” needs manual review.`); continue; }
    if (grade.review === 'grade_out_of_range') { issue('Enter a numeric grade from 1.00 to 5.00.'); continue; }
    if (grade.status === 'In progress') { pending++; continue; }
    if (grade.grade !== null && Math.abs(grade.grade * 100 - Math.round(grade.grade * 100)) > 0.00001) { issue('Use up to two decimal places for a numeric grade.'); continue; }
    if (record.transfer_school) { issue('This course has a transferred grade. Review it in the student record.'); continue; }
    const sameTerm = normalizeSchoolYear(record.academic_year_taken) === schoolYear && record.semester_taken === semester;
    const unused = record.version === null || (record.status === 'Not taken' && record.grade === null && !record.academic_year_taken && !record.semester_taken && record.attempt_no === 1);
    if (!sameTerm && !unused) { issue('A course record exists for a different or unspecified term. Review its grade or start a retake in the student record.'); continue; }
    if (sameTerm && record.status === grade.status && record.grade === grade.grade) { unchanged++; continue; }
    if (record.grade !== null || record.status === 'Incomplete') replacements++;
    changes.push({ row: row.row, studentNo: row.studentNo, course: row.code, grade: grade.grade, status: grade.status,
      savedGrade: record.grade, savedStatus: record.status, version: record.version });
  }
  const summary = { rows: rows.length, changed: changes.length, students: new Set(changes.map(change => change.studentNo)).size,
    replacements, unchanged, pending, issues: issues.length };
  const fingerprint = await digest(JSON.stringify({ schoolYear, semester, summary, changes, issues }));
  return { schoolYear, semester, summary, changes, issues, fingerprint };
}

async function savePlan(db, user, plan) {
  const operationId = crypto.randomUUID();
  const marks = JSON.stringify(plan.changes.map(change => [change.studentNo, change.course, change.grade, change.status, change.version]));
  const schoolYearLabel = plan.schoolYear.replace('-', '\u2013');
  const semesterLabel = { 1: '1st semester', 2: '2nd semester', summer: 'Summer' }[plan.semester];
  const detail = `${plan.summary.changed} grades for ${plan.summary.students} students \u00b7 ${schoolYearLabel} \u00b7 ${semesterLabel}`;

  // The first statement gates the rest of the atomic batch. If any reviewed
  // version changed, the event is absent and none of the rows can be written.
  const [event] = await db.batch([
    db.prepare(`INSERT INTO admin_events(id,actor_id,action,title,detail)
      SELECT ?,?,'grades.imported','Imported semester grades',? WHERE NOT EXISTS (
        SELECT 1 FROM json_each(?) j LEFT JOIN progress_records p
        ON p.student_no=json_extract(j.value,'$[0]') AND p.course_code=json_extract(j.value,'$[1]')
        WHERE p.version IS NOT json_extract(j.value,'$[4]')
      )`).bind(operationId, user.id, detail, marks),
    db.prepare(`INSERT INTO progress_records(student_no,course_code,grade,status,academic_year_taken,semester_taken,version,operation_id)
      SELECT json_extract(j.value,'$[0]'),json_extract(j.value,'$[1]'),json_extract(j.value,'$[2]'),json_extract(j.value,'$[3]'),
        ?,?,COALESCE(json_extract(j.value,'$[4]'),0)+1,? FROM json_each(?) j
      WHERE EXISTS (SELECT 1 FROM admin_events WHERE id=?)
      ON CONFLICT(student_no,course_code) DO UPDATE SET grade=excluded.grade,status=excluded.status,
        academic_year_taken=excluded.academic_year_taken,semester_taken=excluded.semester_taken,
        version=excluded.version,operation_id=excluded.operation_id,updated_at=CURRENT_TIMESTAMP`).bind(schoolYearLabel, plan.semester, operationId, marks, operationId),
    db.prepare(`INSERT INTO record_audit(id,actor_id,student_no,course_code,grade,status,instructor,academic_year_taken,semester_taken,transfer_school,attempt_no)
      SELECT lower(hex(randomblob(16))),?,p.student_no,p.course_code,p.grade,p.status,p.instructor,p.academic_year_taken,p.semester_taken,p.transfer_school,p.attempt_no
      FROM json_each(?) j JOIN progress_records p ON p.student_no=json_extract(j.value,'$[0]') AND p.course_code=json_extract(j.value,'$[1]')
      WHERE p.operation_id=?`).bind(user.id, marks, operationId),
  ]);
  return event.meta.changes === 1;
}

export async function adminGradeImport(request, db, user, { json, body, digest }) {
  const path = new URL(request.url).pathname;
  if (path !== '/api/grade-import/preview' && path !== '/api/grade-import/apply') return null;
  if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Use POST for grade uploads.' }, 405, { Allow: 'POST' });
  const input = await body(request, gradeImportBodyBytes);
  const plan = await importPlan(db, input, digest);
  if (path.endsWith('/preview')) {
    const { changes, ...preview } = plan;
    return json({ ...preview, changes: changes.map(({ version, ...change }) => change) });
  }
  if (input.fingerprint !== plan.fingerprint || (plan.changes.length && !await savePlan(db, user, plan))) {
    return json({ error: 'Saved grades changed after the preview. Preview the workbook again before importing.' }, 409);
  }
  return json({ schoolYear: plan.schoolYear, semester: plan.semester, summary: plan.summary });
}
