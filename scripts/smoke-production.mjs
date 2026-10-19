const origin = process.argv[2];
if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Usage: npm run production:smoke -- https://your-production-host');
const base = new URL(origin).origin;
for (const [path, status] of [['/', 200], ['/api/health', 200], ['/api/session', 401]]) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (response.status !== status) throw new Error(`${path}: expected ${status}, received ${response.status}`);
  if (response.headers.get('X-Content-Type-Options') !== 'nosniff' || response.headers.get('X-Frame-Options') !== 'DENY') throw new Error(`${path}: missing security headers`);
  if (path.startsWith('/api/') && response.headers.get('Cache-Control') !== 'no-store') throw new Error(`${path}: API caching must be disabled`);
  if (path === '/api/health' && (await response.json()).status !== 'ok') throw new Error('Database is not ready');
  console.log(`PASS ${path}`);
}
console.log('HTTPS, application, database readiness, and security headers verified. No student data was accessed.');
