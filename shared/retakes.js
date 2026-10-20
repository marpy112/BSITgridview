export function nextRetakeTerm(schoolYear, semester) {
  if (!/^\d{4}[–-]\d{4}$/.test(schoolYear || '') || !['1', '2', 'summer'].includes(semester)) return null;
  const start = Number(schoolYear.slice(0, 4));
  if (Number(schoolYear.slice(5)) !== start + 1 || start < 2000 || start >= 2199) return null;
  return { schoolYear: `${start + 1}–${start + 2}`, semester };
}

export function retakeLabel(term) {
  if (!term) return '';
  const labels = { 1: '1st semester', 2: '2nd semester', summer: 'Summer' };
  return `${term.schoolYear} · ${labels[term.semester]}`;
}

export function gradeForAverage(course) {
  return course.grade ?? course.pastAttempts?.at(-1)?.grade ?? null;
}
