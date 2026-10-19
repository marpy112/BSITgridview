export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({ error: 'The service is temporarily unavailable. Please try again later.' }));
  if (!response.ok) throw Object.assign(new Error(data.error || 'The request failed.'), { status: response.status });
  return data;
}
