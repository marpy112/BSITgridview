// Use the same identity normalization as the instructor directory on the server.
export const instructorNameKey = name => String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const searchKey = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const normalizeYear = year => String(year || '').trim().replace(/[\u2013\u2014]/g, '-');
const termOrder = { '1': 1, '2': 2, summer: 3, '': 4 };

export function buildInstructorDirectory(instructors = [], students = []) {
  const directory = new Map();
  function findInstructor(name, id) {
    const key = instructorNameKey(name);
    if (!key || key === 'unassigned') return null;
    if (!directory.has(key)) directory.set(key, { id: id || `record:${key}`, name: name.normalize('NFC').replace(/\s+/g, ' ').trim(), groups: new Map() });
    return directory.get(key);
  }
  for (const instructor of instructors) findInstructor(instructor.name, instructor.id);
  for (const student of students) {
    for (const course of student.courses || []) {
      for (const attempt of [course, ...(course.pastAttempts || [])]) {
        const instructor = findInstructor(attempt.instructor);
        if (!instructor) continue;
        const schoolYear = normalizeYear(attempt.academicYearTaken);
        const semester = ['1', '2', 'summer'].includes(String(attempt.semesterTaken)) ? String(attempt.semesterTaken) : '';
        const yearLevel = [1, 2, 3, 4].includes(Number(course.year)) ? String(Number(course.year)) : '';
        const key = JSON.stringify([course.code, schoolYear, semester, yearLevel]);
        if (!instructor.groups.has(key)) instructor.groups.set(key, { key, code: course.code, title: course.title, schoolYear, semester, yearLevel, studentIds: new Set() });
        instructor.groups.get(key).studentIds.add(student.id);
      }
    }
  }
  return [...directory.values()].map(({ groups, ...instructor }) => ({
    ...instructor,
    assignments: [...groups.values()].map(({ studentIds, ...group }) => ({ ...group, students: studentIds.size })).sort((a, b) =>
      b.schoolYear.localeCompare(a.schoolYear) || termOrder[a.semester] - termOrder[b.semester] || Number(a.yearLevel) - Number(b.yearLevel) || a.code.localeCompare(b.code, undefined, { numeric: true })
    ),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function filterInstructorDirectory(directory, { query = '', schoolYear = 'all', semester = 'all', yearLevel = 'all' } = {}) {
  const words = searchKey(query).trim().split(/\s+/).filter(Boolean);
  const hasFilters = [schoolYear, semester, yearLevel].some(value => value !== 'all');
  return directory.filter(instructor => words.every(word => searchKey(instructor.name).includes(word))).map(instructor => ({
    ...instructor,
    assignments: instructor.assignments.filter(assignment =>
      (schoolYear === 'all' || (assignment.schoolYear || 'unknown') === schoolYear) &&
      (semester === 'all' || (assignment.semester || 'unknown') === semester) &&
      (yearLevel === 'all' || (assignment.yearLevel || 'unknown') === yearLevel)
    ),
  })).filter(instructor => !hasFilters || instructor.assignments.length);
}
