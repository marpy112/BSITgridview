import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { hash, compare } from 'bcryptjs';
import { createTursoDatabase, wrapTursoClient } from '../server/turso-database.js';
import { handleVercelRequest } from '../server/vercel-api.js';
import { inspectSource, importCopy, verifyCopy } from '../scripts/turso-transfer.mjs';

async function sourceDatabase() {
  const client = createClient({ url: ':memory:' });
  for (const file of fs.readdirSync('migrations').filter(file => file.endsWith('.sql')).sort()) await client.executeMultiple(fs.readFileSync('migrations/' + file, 'utf8'));
  const password = await hash('Existing administrator password', 4);
  await client.batch([
    "INSERT INTO students(student_no,name,year_level,last_name,is_transferee,previous_school) VALUES('5225659','TEST DE LA PEÑA',2,'DE LA PEÑA',1,'PUP')",
    { sql: "INSERT INTO accounts(id,identifier,role,password_hash) VALUES('admin','admin@example.test','admin',?)", args: [password] },
    { sql: "INSERT INTO accounts(id,identifier,role,password_hash,student_no,must_change_password) VALUES('student','5225659','student',?,'5225659',1)", args: [password] },
    "INSERT INTO progress_records(student_no,course_code) SELECT '5225659',code FROM courses",
    "UPDATE progress_records SET status='In progress',academic_year_taken='2027–2028',semester_taken='2',attempt_no=2,version=3 WHERE course_code='IT 12'",
    "INSERT INTO course_attempts(student_no,course_code,attempt_no,grade,status,instructor,academic_year_taken,semester_taken,transfer_school,archived_by) VALUES('5225659','IT 12',1,5,'Failed','Unassigned','2026–2027','2','TUP','admin')",
    "INSERT INTO record_audit(id,actor_id,student_no,course_code,grade,status,instructor,academic_year_taken,semester_taken,transfer_school,attempt_no) VALUES('audit','admin','5225659','IT 12',5,'Failed','Unassigned','2026–2027','2','TUP',1)",
    "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES('old-session','admin',9999999999)",
    "INSERT INTO login_attempts(bucket_key,attempts,expires_at) VALUES('old-limit',1,9999999999)",
  ], 'write');
  return client;
}

test('Turso adapter keeps bindings, final grades, affected-row counts, and atomic rollback', async () => {
  const client = createClient({ url: ':memory:' });
  const db = wrapTursoClient(client);
  try {
    await db.prepare('CREATE TABLE grades(id TEXT PRIMARY KEY,grade REAL)').run();
    const writes = await db.batch([db.prepare('INSERT INTO grades VALUES(?,?)').bind('IT 01', 1.75), db.prepare('INSERT INTO grades VALUES(?,?)').bind('IT 02', null)]);
    assert.equal(writes[0].meta.changes, 1);
    assert.deepEqual(await db.prepare('SELECT * FROM grades WHERE id=?').bind('IT 01').first(), { id: 'IT 01', grade: 1.75 });
    assert.equal(await db.prepare('SELECT grade FROM grades WHERE id=?').bind('IT 01').first('grade'), 1.75);
    assert.equal(await db.prepare('SELECT * FROM grades WHERE id=?').bind('missing').first(), null);
    await assert.rejects(db.batch([db.prepare('INSERT INTO grades VALUES(?,?)').bind('IT 03', 2), db.prepare('INSERT INTO grades VALUES(?,?)').bind('IT 01', 5)]), /Unique constraint/);
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM grades').first('count'), 2);
    await assert.rejects(db.prepare('SELECT private_password_column FROM grades').all(), error => error.status === 503 && !error.message.includes('private_password'));
  } finally { db.close(); }
});

test('production Turso configuration requires a secure Turso host and fails closed on previews', async () => {
  for (const [url, token] of [['http://test.turso.io','token'],['https://attacker.example','token'],['https://test.turso.io?token=secret','token'],['libsql://test.turso.io',''],['file:/private.db','token']]) await assert.rejects(createTursoDatabase(url, token));
  const client = await createTursoDatabase('libsql://test-org.turso.io', 'example-token'); client.close();
  const req = new Request('https://bsitgridview.vercel.app/api/session');
  const env = { VERCEL: '1', VERCEL_ENV: 'production', GRADEVIEW_DATABASE_PROVIDER: 'turso', TURSO_DATABASE_URL: 'libsql://test-org.turso.io', TURSO_AUTH_TOKEN: 'example-token' };
  assert.equal((await handleVercelRequest(req, env)).status, 401, 'Turso does not need Cloudflare credentials');
  for (const extra of [{ VERCEL_ENV: 'preview' }, { TURSO_AUTH_TOKEN: '' }, { TURSO_DATABASE_URL: 'file:/private.db' }, { GRADEVIEW_DATABASE_PROVIDER: 'unknown' }]) assert.equal((await handleVercelRequest(req, { ...env, ...extra })).status, 503);
});

test('migration verifies every field, preserves passwords and retakes, and expires old sessions', async () => {
  const source = await sourceDatabase();
  const target = createClient({ url: ':memory:' });
  try {
    const snapshot = await inspectSource(source);
    const counts = await importCopy(snapshot, target);
    assert.equal(counts.students, 1); assert.equal(counts.progress_records, 68); assert.equal(counts.sessions, 0); assert.equal(counts.login_attempts, 0);
    const account = (await target.execute("SELECT password_hash,must_change_password FROM accounts WHERE id='student'")).rows[0];
    assert(await compare('Existing administrator password', account.password_hash));
    assert.equal(account.must_change_password, 1);
    assert.equal((await target.execute('SELECT transfer_school FROM course_attempts')).rows[0].transfer_school, 'TUP');
    assert.equal((await target.execute("SELECT attempt_no FROM progress_records WHERE course_code='IT 12'")).rows[0].attempt_no, 2);
    await verifyCopy(snapshot, target);
    await assert.rejects(importCopy(snapshot, target), /not empty/);
    await target.execute("UPDATE progress_records SET instructor='Changed' WHERE course_code='IT 12'");
    await assert.rejects(verifyCopy(snapshot, target), /Verification failed/);
  } finally { source.close(); target.close(); }
});

test('failed migration rolls back schema and rows instead of leaving a partial copy', async () => {
  const source = await sourceDatabase(); const target = createClient({ url: ':memory:' });
  try {
    const snapshot = await inspectSource(source);
    snapshot.indexes.push('CREATE INDEX broken_index ON missing_table(missing_column)');
    await assert.rejects(importCopy(snapshot, target));
    assert.equal((await target.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows[0].count, 0);
  } finally { source.close(); target.close(); }
});
