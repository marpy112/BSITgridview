import test from 'node:test';
import assert from 'node:assert/strict';
import curriculum from '../src/curriculum.json' with { type: 'json' };
import { graduationProgress } from '../shared/graduation.js';
import { createFixture, executeLocal } from './helpers/d1-fixture.mjs';

const required = curriculum.map(course => course.code);
const complete = () => curriculum.map(course => ({ ...course, grade: 1.78, status: 'Passed' }));

test('graduation requires a saved passing grade for every required course, including Summer and OJT', () => {
  assert.deepEqual(graduationProgress(complete(), required), { eligible: true, completed: 68, required: 68 });
  assert.equal(graduationProgress([], []).eligible, false);
  assert.equal(graduationProgress(complete().filter(course => course.year === 4), required).eligible, false);
  for (const code of ['OJT', ...curriculum.filter(course => course.semester === 'summer').map(course => course.code)]) {
    assert.equal(graduationProgress(complete().filter(course => course.code !== code), required).eligible, false, code);
  }
  for (const [status, grade] of [['Failed', 5], ['Incomplete', null], ['In progress', null], ['Not taken', null], ['Passed', null], ['Passed', 0], ['Passed', 3.25], ['Passed', '1.5']]) {
    const records = complete(); Object.assign(records[0], { status, grade });
    assert.equal(graduationProgress(records, required).eligible, false, `${status} / ${grade}`);
  }
  const duplicate = complete(); duplicate[0] = duplicate[1];
  assert.equal(graduationProgress(duplicate, required).eligible, false, 'duplicates cannot replace a missing required course');
  const retake = complete(); retake[0].pastAttempts = [{ grade: 5, status: 'Failed' }]; retake[1].transferSchool = 'PUP';
  assert.equal(graduationProgress(retake, required).eligible, true, 'passed retakes and transferred passing grades count');
});

const base = process.env.GRADEVIEW_TEST_URL;
if (base && (!process.env.GRADEVIEW_TEST_CONFIG || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname))) throw new Error('Graduation tests require an isolated local database.');
const call = (route, method = 'GET', data, cookie) => fetch(base + route, { method, headers: { Origin: base, 'Content-Type': 'application/json', 'X-Gradeview-Partial': '1', ...(cookie ? { Cookie: cookie } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
async function login(role, identifier, password) {
  const response = await call('/api/login', 'POST', { role, identifier, password });
  assert.equal(response.status, 200);
  return response.headers.get('Set-Cookie').split(';')[0];
}

test('graduation is notified without changing status, and only an admin can approve it atomically once', { skip: !base }, async () => {
  const fixture = await createFixture();
  const endpoint = `/api/students/${fixture.studentId}/graduation`;
  const confirmation = { confirmStudentId: fixture.studentId };
  const own = async cookie => (await (await call('/api/session', 'GET', null, cookie)).json()).students.find(student => student.id === fixture.studentId);
  try {
    const admin = await login('admin', fixture.adminEmail, fixture.password);
    const student = await login('student', fixture.studentId, fixture.password);
    assert.equal((await call(endpoint, 'POST', confirmation)).status, 401);
    assert.equal((await call(endpoint, 'POST', confirmation, student)).status, 403);
    assert.equal((await call(endpoint, 'POST', { confirmStudentId: 'wrong' }, admin)).status, 400);
    assert.equal((await call('/api/students/missing/graduation', 'POST', { confirmStudentId: 'missing' }, admin)).status, 404);
    assert.equal((await call(endpoint, 'POST', confirmation, admin)).status, 409);
    assert.equal((await own(student)).graduation.eligible, false);
    assert.equal((await call('/api/students', 'POST', { id: 'no-graduation-bypass', firstName: 'Test', middleName: '', lastName: 'Student', year: 4, email: '', studentStatus: 'Graduated' }, admin)).status, 400);
    const profile = { year: 4, email: '', studentStatus: 'Graduated' };
    assert.equal((await call(`/api/students/${fixture.studentId}`, 'PATCH', profile, admin)).status, 409);
    executeLocal(`UPDATE progress_records SET grade=2,status='Passed' WHERE student_no='${fixture.studentId}' AND course_code<>'OJT';`);
    assert.equal((await own(student)).graduation.completed, 67);
    assert.equal((await call(endpoint, 'POST', confirmation, admin)).status, 409, 'OJT cannot be omitted');
    executeLocal(`UPDATE progress_records SET grade=2,status='Passed' WHERE student_no='${fixture.studentId}' AND course_code='OJT';`);
    const ready = await own(student);
    assert.equal(ready.graduation.eligible, true);
    assert.equal(ready.studentStatus, 'Active', 'finishing grades does not automatically graduate the student');
    assert.equal(ready.graduationApprovedAt, null);
    assert.equal((await call(`/api/students/${fixture.studentId}`, 'PATCH', profile, admin)).status, 409, 'even a completed record requires explicit approval');
    executeLocal(`UPDATE progress_records SET grade=5,status='Failed',version=version+1 WHERE student_no='${fixture.studentId}' AND course_code='IT 03';`);
    assert.equal((await call(endpoint, 'POST', confirmation, admin)).status, 409, 'approval rechecks grades after the notification was displayed');
    executeLocal(`UPDATE progress_records SET grade=2,status='Passed',version=version+1 WHERE student_no='${fixture.studentId}' AND course_code='IT 03'; CREATE TRIGGER reject_graduation_test BEFORE INSERT ON admin_events WHEN NEW.action='student.graduation_approved' BEGIN SELECT RAISE(ABORT,'test approval rollback'); END;`);
    const rejected = await call(endpoint, 'POST', confirmation, admin);
    assert([500, 503].includes(rejected.status));
    assert.equal((await own(student)).studentStatus, 'Active', 'a failed audit write rolls back the status change');
    assert.equal((await own(student)).graduationApprovedAt, null);
    executeLocal('DROP TRIGGER reject_graduation_test;');
    const approvals = await Promise.all([call(endpoint, 'POST', confirmation, admin), call(endpoint, 'POST', confirmation, admin)]);
    assert.deepEqual(approvals.map(response => response.status).sort(), [200, 409]);
    const approved = await approvals.find(response => response.status === 200).json();
    assert.equal(approved.partialStudents, true);
    assert.equal(approved.students.length, 1);
    assert.equal(approved.graduationApprovedStudentId, fixture.studentId);
    assert.equal(approved.students[0].studentStatus, 'Graduated');
    assert(approved.students[0].graduationApprovedAt);
    assert.equal(approved.activity.filter(event => event.text.startsWith('Graduation approved:')).length, 1);
    const refreshed = await own(student);
    assert.equal(refreshed.studentStatus, 'Graduated');
    assert.equal(refreshed.graduation.eligible, true);
    assert.equal(refreshed.graduationApprovedAt, approved.students[0].graduationApprovedAt);
    assert.equal((await call(`/api/students/${fixture.studentId}`, 'PATCH', { year: 4, email: '', studentStatus: 'Active', expectedStudentStatus: 'Active' }, admin)).status, 409, 'an older open profile form cannot undo the approval');
    assert.equal((await own(student)).studentStatus, 'Graduated');
  } finally {
    executeLocal('DROP TRIGGER IF EXISTS reject_graduation_test;');
    fixture.dispose();
  }
});
