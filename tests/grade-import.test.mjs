import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { utils, write } from 'xlsx';
import { wrapTursoClient } from '../server/turso-database.js';
import worker from '../server/worker.js';
import { readGradeWorkbook } from '../src/admin/grade-workbook.js';

const headings = ['School Year', 'Semester', 'Student ID', 'Last Name', 'Program', 'Subject', 'Subject Title', 'Units', 'Final Grade', 'Removal Grade'];
const gradeRow = (semester = '2nd', id = '000001', subject = 'GE CORE 5', title = 'Purposive Communication', grade = 2, removal = '') =>
  ['2026-2027', semester, id, 'Test', 'BSIT', subject, title, 3, grade, removal];

function excelFile(rows, bookType = 'xlsx') {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([headings, ...rows]), 'Grades');
  const bytes = write(workbook, { type: 'array', bookType });
  return new File([bytes], bookType === 'biff8' ? 'grades.xls' : 'grades.xlsx');
}

test('reads xls and xlsx identically and refuses mixed-semester files', async () => {
  const rows = [gradeRow(), gradeRow('2', '000002', 'GE CORE 5', 'Purposive Communication', 'INC')];
  const xlsx = await readGradeWorkbook(excelFile(rows));
  assert.deepEqual(await readGradeWorkbook(excelFile(rows, 'biff8')), xlsx);
  assert.equal(xlsx.rows[0].studentNo, '000001');
  assert.equal(xlsx.semester, '2');
  await assert.rejects(readGradeWorkbook(excelFile([gradeRow(), gradeRow('1st')])), /one semester per file/);
  await assert.rejects(readGradeWorkbook(new File(['a,b,c'], 'grades.xls')), /match its Excel extension/);
});

async function setup() {
  const client = createClient({ url: 'file::memory:', intMode: 'number' });
  const db = wrapTursoClient(client);
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await client.executeMultiple(await readFile(new URL(file, dir), 'utf8'));
  }
  const accountTokens = { admin: 'a'.repeat(64), student: 'b'.repeat(64) };
  await client.executeMultiple(`INSERT INTO students(student_no,name,last_name,year_level) VALUES('000001','Sample Test','Test',1),('000002','Other Test','Test',1);
    INSERT INTO accounts(id,identifier,role,password_hash) VALUES('upload-admin','upload-admin','admin','unused');
    INSERT INTO accounts(id,identifier,role,password_hash,student_no) VALUES('student-user','000001','student','unused','000001');
    INSERT INTO progress_records(student_no,course_code,grade,status,academic_year_taken,semester_taken,version,instructor)
      VALUES('000001','GE CORE 1',1.5,'Passed','2026-2027','1',1,'Original Instructor'),
      ('000001','GE CORE 5',NULL,'Not taken','','',0,'Second Instructor'),
      ('000002','GE CORE 5',2,'Passed','2026-2027','2',1,'Unassigned');`);
  for (const [role, id] of [['admin','upload-admin'], ['student','student-user']]) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accountTokens[role]));
    await client.execute({ sql:'INSERT INTO sessions VALUES(?,?,?)', args:[Buffer.from(digest).toString('hex'), id, Math.floor(Date.now() / 1000) + 3600] });
  }
  const request = (action, payload, role = 'admin', database = db) => worker.fetch(new Request(`http://localhost/api/grade-import/${action}`, {
    method:'POST', headers:{ Origin:'http://localhost', 'Content-Type':'application/json', ...(role && { Cookie:`gradeview_session=${accountTokens[role]}` }) },
    body:JSON.stringify(payload),
  }), { DB:database });
  return { client, db, request };
}

test('preview and apply update a new semester, skip unsafe rows, and write audits once', async () => {
  const { client, request } = await setup();
  try {
    const upload = await readGradeWorkbook(excelFile([
      gradeRow('2nd','000001','GE CORE 5','Purposive Communication',5,1.75),
      gradeRow('2nd','000001','GE CORE 6','Art Appreciation','INC'),
      gradeRow('2nd','000001','GE CORE 1','Understanding the Self',1),
      gradeRow('2nd','000002','GE CORE 5','Purposive Communication',''),
      gradeRow('2nd','000002','GE CORE 6','Art Appreciation','DRP'),
      gradeRow('2nd','000003'),
      gradeRow('2nd','000002','GE CORE 6','Purposive Communication',1),
    ]));
    assert.equal((await request('preview', upload, null)).status, 401);
    assert.equal((await request('apply', upload, 'student')).status, 403);
    const preview = await (await request('preview', upload)).json();
    assert.deepEqual(preview.summary, { rows:7, changed:2, students:1, replacements:0, unchanged:0, pending:1, issues:4 });
    assert.match(preview.issues.at(-1).message, /Subject code, title, and units/);
    assert.equal((await client.execute('SELECT count(*) AS total FROM record_audit')).rows[0].total, 0);
    const apply = await request('apply', { ...upload, fingerprint:preview.fingerprint });
    assert.equal(apply.status, 200);
    const records = (await client.execute('SELECT course_code,grade,status,instructor,semester_taken FROM progress_records ORDER BY student_no,course_code')).rows;
    assert.deepEqual(records.map(row => [...Object.values(row)]), [
      ['GE CORE 1',1.5,'Passed','Original Instructor','1'], ['GE CORE 5',1.75,'Passed','Second Instructor','2'],
      ['GE CORE 6',null,'Incomplete','Unassigned','2'], ['GE CORE 5',2,'Passed','Unassigned','2'],
    ]);
    assert.equal((await client.execute('SELECT semester FROM academic_calendar')).rows[0].semester, '1');
    assert.equal((await request('apply', { ...upload, fingerprint:preview.fingerprint })).status, 409);
    assert.equal((await client.execute('SELECT count(*) AS total FROM record_audit')).rows[0].total, 2);
    assert.equal((await client.execute("SELECT count(*) AS total FROM admin_events WHERE action='grades.imported'")).rows[0].total, 1);
  } finally { client.close(); }
});

test('same-term changes are rejected atomically when another admin edits a row during apply', async () => {
  const { client, db, request } = await setup();
  try {
    const upload = await readGradeWorkbook(excelFile([
      gradeRow('1st','000001','GE CORE 1','Understanding the Self',2),
      gradeRow('1st','000001','GE CORE 2','Readings in Philippine History',2),
    ]));
    const preview = await (await request('preview', upload)).json();
    assert.equal(preview.summary.replacements, 1);
    const racingDb = { ...db, async batch(statements) {
      if (statements.length === 3) await client.execute("UPDATE progress_records SET grade=1.25,version=version+1 WHERE course_code='GE CORE 1'");
      return db.batch(statements);
    } };
    assert.equal((await request('apply', { ...upload, fingerprint:preview.fingerprint }, 'admin', racingDb)).status, 409);
    assert.equal((await client.execute("SELECT grade FROM progress_records WHERE course_code='GE CORE 1'")).rows[0].grade, 1.25);
    assert.equal((await client.execute("SELECT * FROM progress_records WHERE course_code='GE CORE 2'")).rows.length, 0);
    assert.equal((await client.execute('SELECT * FROM record_audit')).rows.length, 0);
  } finally { client.close(); }
});
