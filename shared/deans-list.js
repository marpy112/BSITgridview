export const deansListGradeLimit = 2;
export const normalizeSchoolYear = value => String(value || '').trim().replace(/[\u2013\u2014]/g, '-');
export const deansListCriteria = 'Every final grade must be 1.00–2.00; no INC; not a transferee; all enrolled subjects must have posted final grades for the selected semester.';

export function validDeansListTerm(schoolYear, semester) {
  const match = /^(\d{4})-(\d{4})$/.exec(normalizeSchoolYear(schoolYear));
  return Boolean(match && Number(match[1]) >= 2000 && Number(match[1]) <= 2199 && Number(match[2]) === Number(match[1]) + 1 && ['1', '2', 'summer'].includes(semester));
}

const validFinal = record => typeof record.grade === 'number' && Number.isFinite(record.grade) && record.grade >= 1 && record.grade <= 5 && Math.abs(record.grade * 100 - Math.round(record.grade * 100)) < 0.000001 &&
  ((record.status === 'Passed' && record.grade <= 3) || (record.status === 'Failed' && record.grade > 3));
const rosterSignature = roster => JSON.stringify([String(roster.yearLevel || ''), roster.subjects.map(subject => [subject.code, subject.units]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))]);

// Only a verified enrollment roster can prove that all semester grades are up.
// Records from other semesters and replacement grades from later retakes never
// contribute to this semester's eligibility or weighted average.
export function evaluateDeansList({ students = [], records = [], enrollments = [], schoolYear, semester }) {
  schoolYear = normalizeSchoolYear(schoolYear);
  if (!validDeansListTerm(schoolYear, semester)) throw new Error('Choose a valid school year and semester.');
  const inTerm = value => normalizeSchoolYear(value.schoolYear) === schoolYear && value.semester === semester;
  const recordsByStudent = new Map(), rostersByStudent = new Map();
  for (const [values, target] of [[records, recordsByStudent], [enrollments, rostersByStudent]]) {
    for (const value of values.filter(inTerm)) {
      if (!target.has(value.studentId)) target.set(value.studentId, []);
      target.get(value.studentId).push(value);
    }
  }
  const results = [];
  for (const student of students) {
    const semesterRecords = recordsByStudent.get(student.id) || [];
    const rosters = rostersByStudent.get(student.id) || [];
    if (!semesterRecords.length && !rosters.length) continue;
    const reasons = [];
    let pending = false;
    const addReason = (code, text, blocksVerification = false) => { reasons.push({ code, text }); pending ||= blocksVerification; };
    if (student.isTransferee || semesterRecords.some(record => record.transferSchool)) addReason('transferee', 'Transferee or transferred subject record.');
    const roster = rosters[0];
    const subjects = roster?.subjects || [];
    if (!roster || !subjects.length) addReason('missing_roster', 'Semester enrollment roster is missing; completeness cannot be verified.', true);
    if (rosters.some(item => item.problem || rosterSignature(item) !== rosterSignature(roster))) addReason('roster_conflict', 'Enrollment subjects or year level need verification.', true);
    const expectedCodes = new Set(subjects.map(subject => subject.code).filter(Boolean));
    if (subjects.some(subject => !subject.code) || expectedCodes.size !== subjects.length) addReason('unmapped_subject', 'Enrolled subjects include an unmapped or duplicate curriculum subject.', true);
    if (semesterRecords.some(record => !expectedCodes.has(record.code)) && roster) addReason('extra_subject', 'Saved semester subjects differ from the enrolled subject list.', true);
    const byCourse = new Map();
    for (const record of semesterRecords) {
      if (!byCourse.has(record.code)) byCourse.set(record.code, []);
      byCourse.get(record.code).push(record);
    }
    const incomplete = semesterRecords.filter(record => record.status === 'Incomplete');
    if (incomplete.length) addReason('inc', `INC: ${[...new Set(incomplete.map(record => record.code))].join(', ')}.`, true);
    const lowGrades = semesterRecords.filter(record => typeof record.grade === 'number' && record.grade > deansListGradeLimit);
    if (lowGrades.length) addReason('grade_limit', `Grade worse than 2.00: ${[...new Set(lowGrades.map(record => record.code))].join(', ')}.`);
    let posted = 0, units = 0, weighted = 0;
    const missing = [], invalidUnits = [];
    for (const subject of subjects) {
      const matches = byCourse.get(subject.code) || [];
      if (matches.length !== 1 || !validFinal(matches[0])) { missing.push(subject.code || subject.title || 'Unmapped subject'); continue; }
      const record = matches[0];
      posted++;
      if (typeof subject.units !== 'number' || !Number.isFinite(subject.units) || subject.units <= 0 || record.units !== subject.units) { invalidUnits.push(subject.code); continue; }
      units += subject.units;
      weighted += Math.round(record.grade * 100) * subject.units;
    }
    if (missing.length) addReason('missing_grades', `Final grade missing, invalid, or ambiguous: ${missing.join(', ')}.`, true);
    if (invalidUnits.length) addReason('invalid_units', `Subject units need verification: ${invalidUnits.join(', ')}.`, true);
    const complete = Boolean(roster && subjects.length && !pending && posted === subjects.length && units > 0);
    const gwa = complete ? weighted / (100 * units) : null;
    const status = reasons.length ? (pending ? 'pending' : 'ineligible') : 'qualified';
    results.push({ id: student.id, name: student.name, program: student.program, yearLevel: roster?.yearLevel || '',
      status, reasons, posted, expected: subjects.length, units, gwa, complete });
  }
  return {
    schoolYear, semester, criteria: deansListCriteria,
    qualified: results.filter(row => row.status === 'qualified').sort((a,b) => a.gwa - b.gwa || a.name.localeCompare(b.name)),
    pending: results.filter(row => row.status === 'pending').sort((a,b) => a.name.localeCompare(b.name)),
    ineligible: results.filter(row => row.status === 'ineligible').sort((a,b) => a.name.localeCompare(b.name)),
    evaluated: results.length, notInTerm: students.length - results.length,
  };
}
