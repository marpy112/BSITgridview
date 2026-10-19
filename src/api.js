export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({ error: 'The API is unavailable. Start Cloudflare local development.' }));
  if (!response.ok) throw Object.assign(new Error(data.error || 'The request failed.'), { status: response.status });
  return data;
}
