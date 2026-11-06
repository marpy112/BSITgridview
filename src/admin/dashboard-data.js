import { gradeForAverage } from '../../shared/retakes.js';

export const recordStatuses = ['Passed', 'In progress', 'Incomplete', 'Failed', 'Not taken'];

export function summarizeDashboard(students) {
  const counts = Object.fromEntries(recordStatuses.map(status => [status, 0]));
  const cohorts = [1, 2, 3, 4].map(year => ({ year, students: 0, passed: 0, records: 0 }));
  let total = 0, followUp = 0, incomplete = 0, failed = 0, ungraded = 0;
  for (const student of students) {
    const cohort = cohorts.find(item => item.year === Number(student.year));
    const records = student.courses || [];
    if (cohort) { cohort.students++; cohort.records += records.length; }
    let hasIncomplete = false, hasFailed = false;
    for (const record of records) {
      total++;
      counts[record.status] = (counts[record.status] || 0) + 1;
      if (record.status === 'Passed' && cohort) cohort.passed++;
      hasIncomplete ||= record.status === 'Incomplete';
      hasFailed ||= record.status === 'Failed';
    }
    if (hasIncomplete) incomplete++;
    if (hasFailed) failed++;
    if (hasIncomplete || hasFailed) followUp++;
    if (!records.some(record => gradeForAverage(record) !== null)) ungraded++;
  }
  return { counts, total, cohorts, followUp, incomplete, failed, ungraded,
    percent: total ? Math.round(counts.Passed / total * 100) : 0 };
}

export function matchesStudentFilter(student, filter) {
  const records = student.courses || [];
  if (filter === 'Incomplete grades') return records.some(record => record.status === 'Incomplete');
  if (filter === 'Failed courses') return records.some(record => record.status === 'Failed');
  if (filter === 'With passed records') return records.some(record => record.status === 'Passed');
  if (filter === 'Needs follow-up') return records.some(record => ['Incomplete', 'Failed'].includes(record.status));
  if (filter === 'No recorded grades') return !records.some(record => gradeForAverage(record) !== null);
  if (filter === 'With pending records') return records.some(record => ['Incomplete', 'In progress', 'Failed'].includes(record.status));
  if (filter === 'Transferees') return student.isTransferee;
  return filter === 'All students' || (student.studentStatus || 'Active') === filter;
}
