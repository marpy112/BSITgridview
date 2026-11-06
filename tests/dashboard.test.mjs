import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDashboard, matchesStudentFilter } from '../src/admin/dashboard-data.js';

const record = (status, grade = null, extra = {}) => ({ status, grade, ...extra });
const students = [
  { id: '1', year: 1, courses: [record('Passed', 1.25), record('Incomplete'), record('Failed', 5)] },
  { id: '2', year: '2', studentStatus: 'Active', courses: [record('In progress'), record('Not taken')] },
  { id: '3', year: 4, studentStatus: 'Graduated', courses: [record('Passed', 2)] },
];

test('dashboard counts every assigned record, including future courses', () => {
  const summary = summarizeDashboard(students);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.counts, { Passed: 2, 'In progress': 1, Incomplete: 1, Failed: 1, 'Not taken': 1 });
  assert.equal(summary.percent, 33);
  assert.equal(summary.followUp, 1, 'one student with two issues is counted once');
  assert.equal(summary.incomplete, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.ungraded, 1);
  assert.deepEqual(summary.cohorts.map(({students, passed, records}) => [students, passed, records]), [[1,1,3], [1,0,2], [0,0,0], [1,1,1]]);
});

test('empty and ungraded data do not produce invalid completion percentages', () => {
  assert.equal(summarizeDashboard([]).percent, 0);
  assert.equal(summarizeDashboard([{ year: 3, courses: [] }]).total, 0);
  assert.equal(summarizeDashboard([{ year: 3, courses: [record('Not taken')] }]).counts['Not taken'], 1);
});

test('review filters agree with dashboard counts and keep active-status defaults', () => {
  const summary = summarizeDashboard(students);
  for (const [filter, count] of [['Needs follow-up', summary.followUp], ['Incomplete grades', summary.incomplete], ['Failed courses', summary.failed], ['No recorded grades', summary.ungraded]]) {
    assert.equal(students.filter(student => matchesStudentFilter(student, filter)).length, count);
  }
  assert.equal(matchesStudentFilter(students[0], 'Active'), true);
  assert.equal(matchesStudentFilter(students[2], 'Active'), false);
  assert.equal(matchesStudentFilter(students[0], 'With passed records'), true);
});

test('zero grades and grades in retake history are recorded grades', () => {
  const student = { year: 1, courses: [record('In progress', null, { pastAttempts: [{ grade: 5 }] })] };
  assert.equal(matchesStudentFilter(student, 'No recorded grades'), false);
  assert.equal(matchesStudentFilter({ courses: [record('Passed', 0)] }, 'No recorded grades'), false);
  assert.equal(summarizeDashboard([student]).ungraded, 0);
});
