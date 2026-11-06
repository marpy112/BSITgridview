import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { wrapTursoClient } from '../server/turso-database.js';
import { adminDeansList, deansEnrollment, deansListReport } from '../server/deans-list.js';

const enrollment = { studentNo: '1', schoolYear: '2026-2027', semester: '1st', yearLevel: '1', courses: [
  { subjectCode: 'GE CORE 1', title: 'Understanding the self', units: '3' },
  { subjectCode: 'GE CORE 2', title: 'Readings in Philippine History', units: '3' },
] };

test('maps original enrolled subject aliases using the existing import mapping', () => {
  const result = deansEnrollment({ student_no: '1', payload_json: JSON.stringify(enrollment) });
  assert.equal(result.problem, false);
  assert.deepEqual(result.subjects.map(subject => subject.code), ['GE CORE 1', 'GE CORE 2']);
  assert.equal(deansEnrollment({ student_no: 'wrong', payload_json: JSON.stringify(enrollment) }).problem, true);
});

test('database report uses a consistent selected-term roster and final-grade snapshot', async () => {
  const client = createClient({ url: 'file::memory:', intMode: 'number' });
  const db = wrapTursoClient(client);
  try {
    await client.executeMultiple(`
      CREATE TABLE students(student_no TEXT PRIMARY KEY,name TEXT,program TEXT,is_transferee INTEGER);
      CREATE TABLE courses(code TEXT PRIMARY KEY,title TEXT,units REAL,year_level INTEGER);
      CREATE TABLE progress_records(student_no TEXT,course_code TEXT,grade REAL,status TEXT,transfer_school TEXT,academic_year_taken TEXT,semester_taken TEXT);
      CREATE TABLE course_attempts(student_no TEXT,course_code TEXT,grade REAL,status TEXT,transfer_school TEXT,academic_year_taken TEXT,semester_taken TEXT);
      CREATE TABLE enrollment_source_records(student_no TEXT,payload_json TEXT,record_type TEXT);
      INSERT INTO students VALUES('1','Student One','BSIT',0);
      INSERT INTO courses VALUES('GE CORE 1','Understanding the self',3,1),('GE CORE 2','Readings in Philippine History',3,1);
      INSERT INTO progress_records VALUES('1','GE CORE 1',1.5,'Passed','','2026–2027','1'),('1','GE CORE 2',2,'Passed','','2026-2027','1');
    `);
    await client.execute({ sql: "INSERT INTO enrollment_source_records VALUES(?,?,'enrollment')", args: ['1', JSON.stringify(enrollment)] });
    let report = await deansListReport(db, '2026-2027', '1');
    assert.equal(report.qualified.length, 1);
    assert.equal(report.qualified[0].gwa, 1.75);
    assert.ok(report.verifiedAt);
    await client.execute("UPDATE progress_records SET grade=NULL,status='Incomplete' WHERE course_code='GE CORE 2'");
    report = await deansListReport(db, '2026-2027', '1');
    assert.equal(report.qualified.length, 0, 'fresh output must remove a student after an INC is saved');
    assert.equal(report.pending.length, 1);
    await client.execute("UPDATE progress_records SET academic_year_taken='2027-2028',grade=1,status='Passed' WHERE course_code='GE CORE 2'");
    await client.execute("INSERT INTO course_attempts VALUES('1','GE CORE 2',5,'Failed','','2026–2027','1')");
    report = await deansListReport(db, '2026-2027', '1');
    assert.equal(report.qualified.length, 0, 'a later successful retake must not replace the original semester grade');
    assert.equal(report.ineligible.length, 1);
    assert.ok(report.ineligible[0].reasons.some(reason => reason.code === 'grade_limit'));
    assert.equal((await deansListReport(db, '2026-2027', '2')).qualified.length, 0);
  } finally { client.close(); }
});

test('admin route rejects student access, writes, and invalid terms before querying grades', async () => {
  const db = { prepare() { throw new Error('Unexpected database access'); } };
  const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
  const url = 'http://localhost/api/deans-list?schoolYear=2026-2027&semester=1';
  assert.equal((await adminDeansList(new Request(url), db, { role: 'student' }, json)).status, 403);
  assert.equal((await adminDeansList(new Request(url, { method: 'POST' }), db, { role: 'admin' }, json)).status, 405);
  await assert.rejects(() => adminDeansList(new Request('http://localhost/api/deans-list?schoolYear=wrong&semester=1'), db, { role: 'admin' }, json), /valid school year/);
  assert.equal(await adminDeansList(new Request('http://localhost/api/other'), db, { role: 'admin' }, json), null);
});
