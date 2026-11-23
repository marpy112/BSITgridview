import { normalizeSchoolYear, validDeansListTerm } from './deans-list.js';

export const gradeImportMaxRows = 5000;
export const gradeImportMaxFileBytes = 5 * 1024 * 1024;
export const gradeImportBodyBytes = 4_000_000;

const semesters = new Map([
  ['1', '1'], ['1st', '1'], ['1st semester', '1'], ['first semester', '1'], ['semester 1', '1'],
  ['2', '2'], ['2nd', '2'], ['2nd semester', '2'], ['second semester', '2'], ['semester 2', '2'],
  ['summer', 'summer'],
]);

export function gradeImportTerm(year, semester) {
  const schoolYear = normalizeSchoolYear(year).replace(/\s*-\s*/g, '-');
  semester = semesters.get(String(semester ?? '').trim().toLowerCase());
  return validDeansListTerm(schoolYear, semester) ? { schoolYear, semester } : null;
}

export function interpretSourceGrade(finalGrade, removalGrade = '') {
  const value = String(removalGrade || finalGrade).trim();
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    const grade = Number(value);
    if (grade >= 1 && grade <= 5) return { grade, status: grade <= 3 ? 'Passed' : 'Failed' };
    if (grade === 0) return { grade: null, status: 'In progress', review: 'zero_grade_placeholder' };
    return { review: 'grade_out_of_range' };
  }
  if (value === 'INC') return { grade: null, status: 'Incomplete' };
  if (['', 'NG', 'TBE'].includes(value)) return { grade: null, status: 'In progress', ...(value ? { review: 'pending_grade_marker' } : {}) };
  return { review: 'unsupported_grade_marker' };
}
