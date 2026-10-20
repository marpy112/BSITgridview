export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Gradeview-Partial': '1', ...options.headers },
  });
  const data = await response.json().catch(() => ({ error: 'The service is temporarily unavailable. Please try again later.' }));
  if (!response.ok) {
    const reset = data.code === 'DATABASE_DAILY_LIMIT' && data.retryAt ? new Date(data.retryAt) : null;
    const message = reset && Number.isFinite(reset.getTime())
      ? `Today's free database allowance has been reached. Please try again after ${reset.toLocaleString()}.`
      : data.error || 'The request failed.';
    throw Object.assign(new Error(message), { status: response.status, code: data.code, retryAt: data.retryAt });
  }
  return data;
}

export function mergeStudents(current, snapshot) {
  if (!snapshot.partialStudents) return snapshot.students;
  const updates = new Map(snapshot.students.map(student => [student.id, student]));
  const existing = new Set(current.map(student => student.id));
  return [...current.map(student => updates.get(student.id) || student), ...snapshot.students.filter(student => !existing.has(student.id))];
}
