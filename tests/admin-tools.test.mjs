import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFixture, executeLocal } from './helpers/d1-fixture.mjs';

const base = process.env.GRADEVIEW_TEST_URL;
if (!base || !process.env.GRADEVIEW_TEST_CONFIG || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Run with npm test against an isolated database.');
const call = (route, method = 'GET', data, cookie, origin = base) => fetch(base + route, {
  method, headers: { Origin: origin, 'Content-Type': 'application/json', Connection: 'close', ...(cookie ? { Cookie: cookie } : {}) },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function login(role, identifier, password, expected = 200) {
  const response = await call('/api/login', 'POST', { role, identifier, password });
  assert.equal(response.status, expected, await response.clone().text());
  return { cookie: response.headers.get('Set-Cookie')?.split(';')[0], data: await response.json() };
}

test('instructors persist independently of assignments, reject duplicates, and require admin access', async () => {
  const fixture = await createFixture();
  let instructorId;
  try {
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const student = await login('student', fixture.studentId, fixture.password);
    const name = `Prof. Peña ${crypto.randomUUID()}`;
    assert.equal((await call('/api/instructors', 'POST', { name })).status, 401);
    assert.equal((await call('/api/instructors', 'GET', undefined, student.cookie)).status, 403);
    assert.equal((await call('/api/instructors', 'POST', { name }, student.cookie)).status, 403);
    assert.equal((await call('/api/instructors', 'POST', { name }, admin.cookie, 'https://attacker.example')).status, 403);
    for (const name of ['', '   ', 'Unassigned', 'unassigned', 'a'.repeat(121), 'bad\nname']) {
      assert.equal((await call('/api/instructors', 'POST', { name }, admin.cookie)).status, 400);
    }
    const created = await call('/api/instructors', 'POST', { name: `  ${name}  ` }, admin.cookie);
    assert.equal(created.status, 201, await created.clone().text());
    const data = await created.json();
    instructorId = data.createdInstructorId;
    assert(data.instructors.some(item => item.id === instructorId && item.name === name));
    assert.equal((await call('/api/instructors', 'POST', { name: name.toUpperCase() }, admin.cookie)).status, 409, 'case variants, including accented names, are duplicates');
    const refreshed = await (await call('/api/session', 'GET', undefined, admin.cookie)).json();
    assert(refreshed.instructors.some(item => item.id === instructorId), 'a new instructor survives a refresh before any assignment');
    const endpoint = `/api/students/${fixture.studentId}/records/IT%2012`;
    assert.equal((await call(endpoint, 'PATCH', { grade: 1.5, status: 'Passed', instructor: 'Not in the directory' }, admin.cookie)).status, 400);
    assert.equal((await call(endpoint, 'PATCH', { grade: 1.5, status: 'Passed', instructor: name }, admin.cookie)).status, 200);
    const own = await (await call('/api/session', 'GET', undefined, student.cookie)).json();
    assert.equal(own.students[0].courses.find(course => course.code === 'IT 12').instructor, name);
    assert.equal(own.instructors, undefined, 'students only receive their assigned instructors in their own records');
  } finally {
    fixture.dispose();
    if (instructorId) executeLocal(`DELETE FROM instructors WHERE id='${instructorId}';`);
  }
});

test('student reset restores the exact surname, revokes only their sessions, and requires password replacement', async () => {
  const fixture = await createFixture();
  const other = await createFixture();
  const surname = 'DE LA PEÑA';
  const endpoint = `/api/students/${fixture.studentId}/reset-password`;
  const confirm = { confirmStudentId: fixture.studentId };
  try {
    executeLocal(`UPDATE students SET last_name='${surname}' WHERE student_no='${fixture.studentId}';`);
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const student = await login('student', fixture.studentId, fixture.password);
    const secondSession = await login('student', fixture.studentId, fixture.password);
    const otherStudent = await login('student', other.studentId, other.password);
    assert.equal((await call(endpoint, 'POST', confirm)).status, 401);
    assert.equal((await call(endpoint, 'POST', confirm, student.cookie)).status, 403);
    assert.equal((await call(endpoint, 'POST', confirm, otherStudent.cookie)).status, 403);
    assert.equal((await call(endpoint, 'POST', confirm, admin.cookie, 'https://attacker.example')).status, 403);
    assert.equal((await call(endpoint, 'POST', { confirmStudentId: other.studentId }, admin.cookie)).status, 400);
    assert.equal((await call('/api/students/missing/reset-password', 'POST', { confirmStudentId: 'missing' }, admin.cookie)).status, 404);
    assert.equal((await call(`/api/students/${other.studentId}/reset-password`, 'POST', { confirmStudentId: other.studentId }, admin.cookie)).status, 400, 'accounts without a saved surname cannot be reset');
    const courseEndpoint = `/api/students/${fixture.studentId}/records/IT%2012`;
    assert.equal((await call(courseEndpoint, 'PATCH', { grade: 1.75, status: 'Passed', instructor: 'Test Instructor' }, admin.cookie)).status, 200);
    const bucket = Math.floor(Date.now() / 1000 / 900);
    const key = createHash('sha256').update(`account:student:${fixture.studentId}:${bucket}`).digest('hex');
    executeLocal(`UPDATE login_attempts SET attempts=10 WHERE bucket_key='${key}';`);
    const reset = await call(endpoint, 'POST', confirm, admin.cookie);
    assert.equal(reset.status, 200, await reset.clone().text());
    const result = await reset.json();
    assert.equal(result.passwordResetStudentId, fixture.studentId);
    assert(!JSON.stringify(result).includes('password_hash'));
    assert(result.activity.some(item => item.text.startsWith('Student password reset:')));
    assert.equal((await call('/api/session', 'GET', undefined, student.cookie)).status, 401);
    assert.equal((await call('/api/session', 'GET', undefined, secondSession.cookie)).status, 401);
    assert.equal((await call('/api/session', 'GET', undefined, admin.cookie)).status, 200);
    assert.equal((await call('/api/session', 'GET', undefined, otherStudent.cookie)).status, 200);
    await login('student', fixture.studentId, fixture.password, 401);
    await login('student', fixture.studentId, surname.toLowerCase(), 401);
    const defaultLogin = await login('student', fixture.studentId, surname);
    assert.equal(defaultLogin.data.mustChangePassword, true);
    assert.equal(defaultLogin.data.students.length, 0);
    assert.equal((await call(courseEndpoint, 'PATCH', { grade: 1, status: 'Passed', instructor: 'Test Instructor' }, defaultLogin.cookie)).status, 403);
    const newPassword = 'My replacement student password!';
    const changed = await call('/api/change-password', 'POST', { newPassword, confirmPassword: newPassword }, defaultLogin.cookie);
    assert.equal(changed.status, 200, await changed.clone().text());
    const unlocked = await changed.json();
    assert.equal(unlocked.mustChangePassword, false);
    assert.equal(unlocked.students[0].courses.length, 68);
    const preserved = unlocked.students[0].courses.find(course => course.code === 'IT 12');
    assert.equal(preserved.grade, 1.75);
    assert.equal(preserved.instructor, 'Test Instructor');
    await login('student', fixture.studentId, surname, 401);
    await login('student', fixture.studentId, newPassword);
  } finally { fixture.dispose(); other.dispose(); }
});
