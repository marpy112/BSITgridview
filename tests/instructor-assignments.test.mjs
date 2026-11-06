import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructorDirectory, filterInstructorDirectory } from '../src/admin/instructor-assignments.js';

const instructors = [{ id: 'one', name: 'Muñez, Erikk Charles' }, { id: 'two', name: 'Maria Santos' }, { id: 'empty', name: 'New Instructor' }];
const subject = (extra = {}) => ({ code: 'IT 01', title: 'Introduction to Computing', year: 1, instructor: 'MUÑEZ, ERIKK CHARLES', academicYearTaken: '2026–2027', semesterTaken: '1', ...extra });

test('groups students by instructor, subject, school year, semester, and curriculum year', () => {
  const directory = buildInstructorDirectory(instructors, [
    { id: '1', year: 4, courses: [subject()] },
    { id: '2', year: 2, courses: [subject({ instructor: '  muñez,   erikk charles ', academicYearTaken: '2026-2027' })] },
    { id: '3', year: 1, courses: [subject({ academicYearTaken: '2025-2026' }), subject({ code: 'IT 02', semesterTaken: '2' })] },
  ]);
  const instructor = directory.find(item => item.id === 'one');
  assert.equal(directory.length, 3);
  assert.equal(instructor.assignments.length, 3);
  const group = instructor.assignments.find(item => item.code === 'IT 01' && item.schoolYear === '2026-2027');
  assert.equal(group.students, 2);
  assert.equal(group.yearLevel, '1', 'year level belongs to the subject, not the current student profile');
  assert.equal(instructor.assignments.at(-1).schoolYear, '2025-2026', 'newest school years appear first');
});

test('includes previous instructors and deduplicates the same student within a subject and term', () => {
  const directory = buildInstructorDirectory(instructors, [{ id: '1', courses: [subject({
    pastAttempts: [
      { instructor: 'Maria Santos', academicYearTaken: '2025-2026', semesterTaken: '2' },
      { instructor: 'MUÑEZ, ERIKK CHARLES', academicYearTaken: '2026-2027', semesterTaken: '1' },
    ],
  })] }]);
  assert.equal(directory.find(item => item.id === 'one').assignments[0].students, 1);
  assert.equal(directory.find(item => item.id === 'two').assignments[0].schoolYear, '2025-2026');
});

test('does not invent school years or semesters and includes assigned but ungraded subjects', () => {
  const directory = buildInstructorDirectory(instructors, [{ id: '1', courses: [subject({ academicYearTaken: '', semesterTaken: '', semester: '1', status: 'Not taken' }), subject({ code: 'IT 02', instructor: 'Unassigned' })] }]);
  const assignment = directory.find(item => item.id === 'one').assignments[0];
  assert.equal(assignment.schoolYear, '');
  assert.equal(assignment.semester, '', 'curriculum semester must not be presented as the saved term');
  assert.equal(assignment.students, 1);
  assert.equal(directory.some(item => item.name === 'Unassigned'), false);
  assert.deepEqual(directory.find(item => item.id === 'empty').assignments, []);
  assert.equal(filterInstructorDirectory(directory, { schoolYear: 'unknown' }).length, 1);
});

test('finds names regardless of case, accents, or word order and combines term filters', () => {
  const directory = buildInstructorDirectory(instructors, [{ id: '1', courses: [subject(), subject({ code: 'IT 02', academicYearTaken: '2025-2026', semesterTaken: '2', year: 2 })] }]);
  const filtered = filterInstructorDirectory(directory, { query: 'ERIKK munez', schoolYear: '2026-2027', semester: '1', yearLevel: '1' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].assignments.length, 1);
  assert.equal(filtered[0].assignments[0].code, 'IT 01');
  assert.equal(filterInstructorDirectory(directory, { query: 'munez', semester: 'summer' }).length, 0);
  assert.equal(filterInstructorDirectory(directory, { query: 'New Instructor' }).length, 1, 'unassigned instructors remain searchable');
  assert.equal(directory.find(item => item.id === 'one').assignments.length, 2, 'filtering preserves the source index');
});

test('retains recorded instructor assignments that are absent from the name directory', () => {
  const directory = buildInstructorDirectory([], [{ id: '1', courses: [subject()] }]);
  assert.equal(directory.length, 1);
  assert.equal(directory[0].assignments[0].code, 'IT 01');
  assert.deepEqual(buildInstructorDirectory(), []);
});
