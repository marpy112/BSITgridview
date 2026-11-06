import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeansList, validDeansListTerm } from '../shared/deans-list.js';

const term = { schoolYear: '2026-2027', semester: '1' };
const student = { id: '1', name: 'Student One', program: 'BSIT', isTransferee: false };
const roster = { studentId: '1', ...term, yearLevel: '2', subjects: [{ code: 'A', title: 'Subject A', units: 3 }, { code: 'B', title: 'Subject B', units: 1 }] };
const records = [{ studentId: '1', code: 'A', units: 3, grade: 1.5, status: 'Passed', ...term }, { studentId: '1', code: 'B', units: 1, grade: 2, status: 'Passed', ...term }];
const evaluate = (overrides = {}) => evaluateDeansList({ students: [student], records, enrollments: [roster], ...term, ...overrides });
const reasons = report => [...report.pending, ...report.ineligible].flatMap(row => row.reasons.map(reason => reason.code));

test('qualifies only complete semester records and calculates a unit-weighted GWA', () => {
  const report = evaluate();
  assert.equal(report.qualified.length, 1);
  assert.equal(report.qualified[0].gwa, 1.625);
  assert.equal(report.qualified[0].units, 4);
  assert.equal(report.qualified[0].yearLevel, '2');
  assert.equal(report.qualified[0].posted, 2);
  assert.equal(report.qualified[0].complete, true);
});

test('checks each individual grade rather than qualifying on GWA alone', () => {
  const report = evaluate({ records: [{ ...records[0], grade: 1 }, { ...records[1], grade: 2.25 }] });
  assert.equal(report.qualified.length, 0);
  assert.equal(report.ineligible[0].gwa, 1.3125, 'a good average cannot hide one grade worse than 2.00');
  assert.ok(reasons(report).includes('grade_limit'));
});

test('accepts 1.00 and exactly 2.00; rejects a grade above the cutoff without rounding it down', () => {
  assert.equal(evaluate({ records: records.map(row => ({ ...row, grade: 2 })) }).qualified.length, 1);
  assert.equal(evaluate({ records: records.map(row => ({ ...row, grade: 1 })) }).qualified.length, 1);
  assert.equal(evaluate({ records: [{ ...records[0], grade: 2.00001 }, records[1]] }).qualified.length, 0);
});

test('a single INC, unposted grade, pending subject, or untaken subject prevents qualification', () => {
  for (const status of ['Incomplete', 'In progress', 'Not taken']) {
    const report = evaluate({ records: [{ ...records[0], grade: null, status }, records[1]] });
    assert.equal(report.qualified.length, 0);
    assert.equal(report.pending.length, 1);
    assert.equal(report.pending[0].gwa, null, 'a partial GWA is not presented as a final GWA');
    assert.ok(reasons(report).includes('missing_grades'));
    if (status === 'Incomplete') assert.ok(reasons(report).includes('inc'));
  }
  assert.equal(evaluate({ records: records.slice(0, 1) }).qualified.length, 0, 'an entirely missing subject must be detected');
});

test('excludes transferees and transferred records even when all grades are good', () => {
  assert.ok(reasons(evaluate({ students: [{ ...student, isTransferee: true }] })).includes('transferee'));
  assert.ok(reasons(evaluate({ records: [{ ...records[0], transferSchool: 'OTHER' }, records[1]] })).includes('transferee'));
});

test('requires a known full roster and does not treat saved subjects as the complete enrollment', () => {
  assert.ok(reasons(evaluate({ enrollments: [] })).includes('missing_roster'));
  assert.ok(reasons(evaluate({ enrollments: [{ ...roster, subjects: [] }] })).includes('missing_roster'));
  assert.ok(reasons(evaluate({ enrollments: [{ ...roster, problem: true }] })).includes('roster_conflict'));
  const extra = { ...records[0], code: 'C' };
  assert.ok(reasons(evaluate({ records: [...records, extra] })).includes('extra_subject'));
});

test('rejects duplicate or unmapped roster subjects, conflicting rosters, and inconsistent units', () => {
  assert.ok(reasons(evaluate({ enrollments: [{ ...roster, subjects: [roster.subjects[0], roster.subjects[0]] }] })).includes('unmapped_subject'));
  assert.ok(reasons(evaluate({ enrollments: [{ ...roster, subjects: [{ code: null, title: 'Legacy subject', units: 3 }] }] })).includes('unmapped_subject'));
  assert.ok(reasons(evaluate({ enrollments: [roster, { ...roster, yearLevel: '3' }] })).includes('roster_conflict'));
  assert.ok(reasons(evaluate({ records: [{ ...records[0], units: 4 }, records[1]] })).includes('invalid_units'));
  assert.ok(reasons(evaluate({ records: [records[0], records[0], records[1]] })).includes('missing_grades'));
});

test('selects the actual school year and term rather than curriculum semester or later retake grade', () => {
  assert.equal(evaluate({ records: records.map(row => ({ ...row, schoolYear: '2025-2026' })) }).qualified.length, 0);
  assert.equal(evaluate({ records: records.map(row => ({ ...row, semester: '2' })) }).qualified.length, 0);
  const later = records.map(row => ({ ...row, schoolYear: '2027-2028' }));
  const original = [{ ...records[0], grade: 5, status: 'Failed' }, records[1]];
  const report = evaluate({ records: [...original, ...later] });
  assert.equal(report.qualified.length, 0);
  assert.ok(reasons(report).includes('grade_limit'));
  assert.equal(evaluate({ records: records.map(row => ({ ...row, schoolYear: '2026–2027' })) }).qualified.length, 1);
});

test('rejects invalid grades and non-final statuses rather than silently counting them', () => {
  for (const grade of [null, NaN, Infinity, '1.50', 0, 6]) assert.equal(evaluate({ records: [{ ...records[0], grade }, records[1]] }).qualified.length, 0);
  assert.equal(evaluate({ records: [{ ...records[0], status: 'Failed' }, records[1]] }).qualified.length, 0);
});

test('keeps students without selected-term enrollment or records outside the eligible list', () => {
  const report = evaluate({ students: [student, { ...student, id: '2' }] });
  assert.equal(report.qualified.length, 1);
  assert.equal(report.notInTerm, 1);
  assert.equal(evaluate({ records: [], enrollments: [] }).qualified.length, 0);
});

test('validates terms including summer', () => {
  assert.equal(validDeansListTerm('2026-2027', 'summer'), true);
  assert.equal(validDeansListTerm('2026-2028', '1'), false);
  assert.equal(validDeansListTerm('x', '1'), false);
  assert.equal(validDeansListTerm('2026-2027', '3'), false);
  assert.throws(() => evaluate({ semester: '3' }), /valid school year/);
});
