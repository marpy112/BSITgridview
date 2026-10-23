export function graduationProgress(records, requiredCodes) {
  const required = [...new Set(requiredCodes)];
  const saved = new Map(records.map(record => [record.code, record]));
  const completed = required.filter(code => {
    const record = saved.get(code);
    return record?.status === 'Passed' && typeof record.grade === 'number' && Number.isFinite(record.grade) && record.grade >= 1 && record.grade <= 3;
  }).length;
  return { eligible: required.length > 0 && completed === required.length, completed, required: required.length };
}
