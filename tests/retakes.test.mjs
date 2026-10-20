import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRetakeTerm, gradeForAverage } from '../shared/retakes.js';
import { createFixture, executeLocal } from './helpers/d1-fixture.mjs';

const base = process.env.GRADEVIEW_TEST_URL;
if (!base || !process.env.GRADEVIEW_TEST_CONFIG || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use npm test against an isolated database.');
const call = (route, method = 'GET', data, cookie, origin = base) => fetch(base + route, { method,
  headers: { Origin: origin, Connection: 'close', 'Content-Type': 'application/json', 'X-Gradeview-Partial': '1', ...(cookie ? { Cookie: cookie } : {}) },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function login(role, identifier, password) {
  const response = await call('/api/login', 'POST', { role, identifier, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get('Set-Cookie').split(';')[0];
}

test('retakes always move one school year forward and preserve the actual semester, including Summer', () => {
  for (const semester of ['1', '2', 'summer']) assert.deepEqual(nextRetakeTerm('2026–2027', semester), { schoolYear: '2027–2028', semester });
  for (const year of ['', '2026–2028', '2199–2200']) assert.equal(nextRetakeTerm(year, '1'), null);
  assert.equal(gradeForAverage({ grade: null, pastAttempts: [{ grade: 5 }] }), 5, 'starting a retake does not erase the last graded result from GWA');
  assert.equal(gradeForAverage({ grade: 2, pastAttempts: [{ grade: 5 }] }), 2);
});

test('retakes archive failures atomically, reject duplicate/stale requests, and retain the same semester through repeated attempts', async () => {
  const fixture = await createFixture();
  const endpoint = `/api/students/${fixture.studentId}/records/IT%2012`;
  const retake = endpoint + '/retake';
  const courseOf = data => data.students.find(student => student.id === fixture.studentId).courses.find(course => course.code === 'IT 12');
  try {
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const student = await login('student', fixture.studentId, fixture.password);
    const initial = { expectedAttemptNumber: 1, expectedRecordVersion: 0 };
    assert.equal((await call(retake, 'POST', initial)).status, 401);
    assert.equal((await call(retake, 'POST', initial, student)).status, 403);
    assert.equal((await call(retake, 'POST', initial, admin, 'https://attacker.example')).status, 403);
    assert.equal((await call(retake, 'POST', initial, admin)).status, 409, 'an untaken course cannot be retaken');
    // A failed transferred grade must retain its origin in history, while the new local attempt starts unmarked.
    assert.equal((await call(`/api/students/${fixture.studentId}`, 'PATCH', { year: 2, studentStatus: 'Active', email: '', isTransferee: true, previousSchool: 'PUP' }, admin)).status, 200);
    const failure = { grade: 5, status: 'Failed', instructor: 'Test Instructor', academicYearTaken: '2026–2027', semesterTaken: '2', transferSchool: 'PUP', ...initial };
    const failed = await call(endpoint, 'PATCH', failure, admin);
    assert.equal(failed.status, 200, await failed.clone().text());
    let course = courseOf(await failed.json());
    assert.deepEqual(course.retake, { schoolYear: '2027–2028', semester: '2' });
    const expected = { expectedAttemptNumber: 1, expectedRecordVersion: course.recordVersion };
    const concurrent = await Promise.all([call(retake, 'POST', expected, admin), call(retake, 'POST', expected, admin)]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
    course = courseOf(await concurrent.find(response => response.status === 200).json());
    assert.equal(course.attemptNumber, 2);
    assert.equal(course.status, 'In progress');
    assert.equal(course.grade, null);
    assert.equal(course.academicYearTaken, '2027–2028');
    assert.equal(course.semesterTaken, '2');
    assert.equal(course.transferSchool, '');
    assert.equal(course.pastAttempts.length, 1);
    assert.equal(course.pastAttempts[0].grade, 5);
    assert.equal(course.pastAttempts[0].transferSchool, 'PUP');
    assert.equal(course.pastAttempts[0].academicYearTaken, '2026–2027');
    assert.equal((await call(endpoint, 'PATCH', failure, admin)).status, 409, 'stale grade entry cannot overwrite a new attempt');
    const current = { grade: 5, status: 'Failed', instructor: 'Unassigned', academicYearTaken: course.academicYearTaken, semesterTaken: course.semesterTaken, transferSchool: '', expectedAttemptNumber: 2, expectedRecordVersion: course.recordVersion };
    assert.equal((await call(endpoint, 'PATCH', { ...current, semesterTaken: '1' }, admin)).status, 400);
    assert.equal((await call(endpoint, 'PATCH', { ...current, academicYearTaken: '2028–2029' }, admin)).status, 400);
    const failedAgain = await call(endpoint, 'PATCH', current, admin);
    assert.equal(failedAgain.status, 200, await failedAgain.clone().text());
    course = courseOf(await failedAgain.json());
    assert.deepEqual(course.retake, { schoolYear: '2028–2029', semester: '2' });
    const second = await call(retake, 'POST', { expectedAttemptNumber: 2, expectedRecordVersion: course.recordVersion }, admin);
    assert.equal(second.status, 200, await second.clone().text());
    course = courseOf(await second.json());
    assert.equal(course.attemptNumber, 3);
    assert.equal(course.pastAttempts.length, 2);
    const passed = await call(endpoint, 'PATCH', { ...current, grade: 2, status: 'Passed', academicYearTaken: '2028–2029', expectedAttemptNumber: 3, expectedRecordVersion: course.recordVersion }, admin);
    assert.equal(passed.status, 200, await passed.clone().text());
    course = courseOf(await passed.json());
    assert.equal(course.grade, 2);
    assert.equal(course.retake, undefined, 'a passing retake no longer needs another scheduled attempt');
    assert.equal(course.pastAttempts.length, 2);
    const own = await (await call('/api/session', 'GET', undefined, student)).json();
    assert.equal(own.students.length, 1);
    assert.equal(own.students[0].courses.length, 68, 'retakes do not duplicate curriculum courses or earned units');
    const history = courseOf(own).pastAttempts;
    assert.deepEqual(history.map(attempt => attempt.grade), [5, 5]);
    assert(history.every(attempt => attempt.semesterTaken === '2'));
  } finally { fixture.dispose(); }
});

test('legacy failures without attendance dates must be dated before a retake can start', async () => {
  const fixture = await createFixture();
  try {
    executeLocal(`UPDATE progress_records SET grade=5,status='Failed' WHERE student_no='${fixture.studentId}' AND course_code='IT 12';`);
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const response = await call(`/api/students/${fixture.studentId}/records/IT%2012/retake`, 'POST', { expectedAttemptNumber: 1, expectedRecordVersion: 0 }, admin);
    assert.equal(response.status, 400);
    assert((await response.json()).error.includes('school year and semester'));
  } finally { fixture.dispose(); }
});
