import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, executeLocal } from './helpers/d1-fixture.mjs';

const base = process.env.GRADEVIEW_TEST_URL;
if (!base || !process.env.GRADEVIEW_TEST_CONFIG || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use npm test with an isolated database.');
const call = (route, method = 'GET', data, cookie) => fetch(base + route, {
  method, headers: { Origin: base, 'Content-Type': 'application/json', Connection: 'close', ...(cookie ? { Cookie: cookie } : {}) },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function login(role, identifier, password) {
  const response = await call('/api/login', 'POST', { role, identifier, password });
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie: response.headers.get('Set-Cookie').split(';')[0], data: await response.json() };
}

test('transferee grades retain the school per course without changing local grades or student permissions', async () => {
  const fixture = await createFixture();
  try {
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const student = await login('student', fixture.studentId, fixture.password);
    const profile = `/api/students/${fixture.studentId}`;
    const endpoint = `${profile}/records/IT%2012`;
    const details = { year: 2, studentStatus: 'Active', email: '', isTransferee: true, previousSchool: ' pup ' };
    const local = { grade: 2.75, status: 'Passed', instructor: 'Unassigned', academicYearTaken: '2025–2026', semesterTaken: '1', transferSchool: '' };
    assert.equal((await call(endpoint, 'PATCH', { ...local, transferSchool: 'PUP' }, admin.cookie)).status, 400, 'regular students cannot receive transferred-school entries');
    assert.equal((await call(profile, 'PATCH', details, student.cookie)).status, 403);
    assert.equal((await call(profile, 'PATCH', { ...details, isTransferee: 'yes' }, admin.cookie)).status, 400);
    assert.equal((await call(profile, 'PATCH', { ...details, previousSchool: '' }, admin.cookie)).status, 400);
    const marked = await call(profile, 'PATCH', details, admin.cookie);
    assert.equal(marked.status, 200, await marked.clone().text());
    const markedProfile = (await marked.json()).students.find(item => item.id === fixture.studentId);
    assert.equal(markedProfile.isTransferee, true);
    assert.equal(markedProfile.previousSchool, 'PUP');
    assert.equal((await call(endpoint, 'PATCH', { ...local, transferSchool: ' tup ' }, student.cookie)).status, 403);
    for (const data of [
      { ...local, grade: null, status: 'Incomplete', transferSchool: 'PUP' },
      { ...local, transferSchool: '<script>' },
      { ...local, transferSchool: 'A'.repeat(31) },
      { ...local, transferSchool: 123 },
    ]) assert.equal((await call(endpoint, 'PATCH', data, admin.cookie)).status, 400);
    assert.equal((await call(endpoint, 'PATCH', { ...local, transferSchool: ' tup ' }, admin.cookie)).status, 200);
    assert.equal((await call(`${profile}/records/IT%2011`, 'PATCH', local, admin.cookie)).status, 200);
    const own = (await (await call('/api/session', 'GET', undefined, student.cookie)).json()).students[0];
    assert.equal(own.isTransferee, true);
    assert.equal(own.previousSchool, 'PUP');
    assert.equal(own.courses.find(course => course.code === 'IT 12').transferSchool, 'TUP', 'course-specific source can differ from the default school');
    assert.equal(own.courses.find(course => course.code === 'IT 12').grade, 2.75);
    assert.equal(own.courses.find(course => course.code === 'IT 11').transferSchool, '', 'current-school grades stay local');
    assert.equal((await call(profile, 'PATCH', { year: 3, studentStatus: 'Active', email: '' }, admin.cookie)).status, 200, 'older clients preserve transfer details when omitted');
    assert.equal((await call(profile, 'PATCH', { ...details, isTransferee: false, previousSchool: '' }, admin.cookie)).status, 409, 'changing type cannot hide existing transferred grades');
    // Existing external grades keep their origin when an older client edits another field.
    const legacy = { ...local, grade: 2.5 }; delete legacy.transferSchool;
    assert.equal((await call(endpoint, 'PATCH', legacy, admin.cookie)).status, 200);
    const refreshed = (await (await call('/api/session', 'GET', undefined, student.cookie)).json()).students[0];
    assert.equal(refreshed.courses.find(course => course.code === 'IT 12').transferSchool, 'TUP');
    assert.equal(refreshed.previousSchool, 'PUP');
    assert.equal(refreshed.year, 3);
    await login('student', fixture.studentId, fixture.password);
    assert.equal((await call(endpoint, 'PATCH', { ...local, transferSchool: '' }, admin.cookie)).status, 200);
    assert.equal((await call(profile, 'PATCH', { ...details, isTransferee: false, previousSchool: '' }, admin.cookie)).status, 200);
    const regular = (await (await call('/api/session', 'GET', undefined, student.cookie)).json()).students[0];
    assert.equal(regular.isTransferee, false);
    assert.equal(regular.courses.find(course => course.code === 'IT 12').grade, 2.75, 'clearing the school annotation preserves the grade');
  } finally { fixture.dispose(); }
});

test('new transferees can be created with a school acronym and still use first-login password changes', async () => {
  const fixture = await createFixture();
  const id = `TRANSFER-${Date.now()}`;
  try {
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const data = { id, firstName: 'Transfer', middleName: '', lastName: 'DELA CRUZ', year: 2, studentStatus: 'Active', email: '', isTransferee: true, previousSchool: 'ssc-r' };
    const response = await call('/api/students', 'POST', data, admin.cookie);
    assert.equal(response.status, 201, await response.clone().text());
    const student = (await response.json()).students.find(item => item.id === id);
    assert.equal(student.isTransferee, true);
    assert.equal(student.previousSchool, 'SSC-R');
    assert.equal(student.courses.length, 68);
    assert(student.courses.every(course => course.grade === null && course.transferSchool === ''));
    const initial = await login('student', id, 'DELA CRUZ');
    assert.equal(initial.data.mustChangePassword, true);
  } finally {
    executeLocal(`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE student_no='${id}'); DELETE FROM record_audit WHERE student_no='${id}'; DELETE FROM progress_records WHERE student_no='${id}'; DELETE FROM accounts WHERE student_no='${id}'; DELETE FROM students WHERE student_no='${id}';`);
    fixture.dispose();
  }
});
