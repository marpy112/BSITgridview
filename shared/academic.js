export const defaultAcademicTerm = { schoolYearStart: 2026, semester: '1', version: 0 };

export function academicYearLabel(term) {
  return `${term.schoolYearStart}–${term.schoolYearStart + 1}`;
}

export function academicTermLabel(term) {
  return `${academicYearLabel(term)} · ${term.semester === '1' ? '1st semester' : '2nd semester'}`;
}

export function nextAcademicTerm(term) {
  return { schoolYearStart: term.schoolYearStart + (term.semester === '2' ? 1 : 0), semester: term.semester === '1' ? '2' : '1', version: term.version + 1 };
}
