import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/d1-fixture.mjs';

const base = process.env.GRADEVIEW_TEST_URL || 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Database tests only run against a local test server.');

async function request(path, { method = 'GET', cookie, data, origin = base } = {}) {
  return fetch(base + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}

async function login(role, identifier, password) {
  const response = await request('/api/login', { method: 'POST', data: { role, identifier, password } });
  assert.equal(response.status, 200, await response.clone().text());
  const header = response.headers.get('Set-Cookie');
  assert(header.includes('HttpOnly'));
  assert(header.includes('SameSite=Strict'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return { cookie: header.split(';')[0], snapshot: await response.json() };
}

test('D1 login, authorization, curriculum, validation, persistent grades, audit, and logout', async () => {
  assert.equal((await request('/')).status, 200);
  const fixture = await createFixture();
  try {
  assert.equal((await request('/api/session')).status, 401);
  const blocked = await request('/api/login', { method: 'POST', origin: 'https://another-site.example', data: { role: 'admin', identifier: fixture.adminEmail, password: fixture.password } });
  assert.equal(blocked.status, 403);
  const wrong = await request('/api/login', { method: 'POST', data: { role: 'student', identifier: fixture.studentId, password: 'incorrect' } });
  assert.equal(wrong.status, 401);

  const admin = await login('admin', fixture.adminEmail, fixture.password);
  const student = await login('student', fixture.studentId, fixture.password);
  assert.equal(admin.snapshot.role, 'admin');
  assert(admin.snapshot.students.length >= 1);
  assert.equal(student.snapshot.students.length, 1);
  assert.equal(student.snapshot.students[0].id, fixture.studentId);
  const curriculum = student.snapshot.students[0].courses;
  assert.equal(curriculum.length, 68);
  assert.equal(curriculum.reduce((sum, course) => sum + course.units, 0), 197);
  assert.equal(JSON.stringify(student.snapshot).includes('password_hash'), false);

  const endpoint = `/api/students/${fixture.studentId}/records/IT%2012`;
  const record = curriculum.find(course => course.code === 'IT 12');
  const original = { grade: record.grade, status: record.status, instructor: record.instructor };
  const updates = { grade: 1.5, status: 'Passed', instructor: 'Database Test Instructor' };
  assert.equal((await request(endpoint, { method: 'PATCH', cookie: student.cookie, data: updates })).status, 403);
  assert.equal((await request(endpoint, { method: 'PATCH', cookie: admin.cookie, data: { ...updates, grade: 4 } })).status, 400);
  assert.equal((await request(endpoint, { method: 'PATCH', cookie: admin.cookie, data: { ...updates, grade: null } })).status, 400);
  assert.equal((await request(endpoint, { method: 'PATCH', cookie: admin.cookie, data: { ...updates, grade: 1.555 } })).status, 400);
  assert.equal((await request('/api/students/missing/records/IT%2012', { method: 'PATCH', cookie: admin.cookie, data: updates })).status, 404);

  try {
    const saved = await fetch(base + endpoint, { method: 'PATCH', headers: { Origin: base, Cookie: admin.cookie, 'Content-Type': 'application/json', 'X-Gradeview-Partial': '1' }, body: JSON.stringify(updates) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const savedData = await saved.json();
    assert.equal(savedData.partialStudents, true);
    assert.equal(savedData.students.length, 1);
    assert.equal(savedData.students[0].id, fixture.studentId);
    assert(savedData.activity.some(item => item.text.includes('IT 12')));
    const refreshed = await (await request('/api/session', { cookie: student.cookie })).json();
    const persisted = refreshed.students[0].courses.find(course => course.code === 'IT 12');
    assert.equal(persisted.grade, 1.5);
    assert.equal(persisted.status, 'Passed');
    assert.equal(persisted.instructor, 'Database Test Instructor');
  } finally {
    const restored = await request(endpoint, { method: 'PATCH', cookie: admin.cookie, data: original });
    assert.equal(restored.status, 200);
  }

  assert.equal((await request('/api/logout', { method: 'POST', cookie: student.cookie })).status, 200);
  assert.equal((await request('/api/session', { cookie: student.cookie })).status, 401);
  assert.equal((await request('/api/logout', { method: 'POST', cookie: admin.cookie })).status, 200);
  } finally { fixture.dispose(); }
});
