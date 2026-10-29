// Free-plan Worker: only database I/O runs here. The API and bcrypt run on Vercel.
import { dailyDatabaseLimit, isDailyDatabaseLimit } from './database-errors.js';
import { databaseReady } from './readiness.js';

const reply = (data, status = 200, headers = {}) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  ...headers,
} });

function authorized(request, secret) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) return false;
  const supplied = request.headers.get('Authorization') || '';
  const expected = `Bearer ${secret}`;
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

async function readStatements(request) {
  if (request.headers.get('Content-Type') !== 'application/json') throw new Error('Invalid payload.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid payload.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // Authenticated template writes may include a single-page PDF (up to 1 MB, base64 encoded).
      if (size > 1500000) { await reader.cancel(); throw new Error('Invalid payload.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const statements = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(statements) || !statements.length || statements.length > 20 || statements.some(statement =>
    !statement || typeof statement.sql !== 'string' || !statement.sql.length || statement.sql.length > 16384 ||
    !Array.isArray(statement.params) || statement.params.length > 100 || statement.params.some(value =>
      value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))))) {
    throw new Error('Invalid payload.');
  }
  return statements;
}

export default {
  async scheduled(_event, env) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<=?').bind(now),
    ]);
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/health' && request.method === 'GET') {
      try {
        const ready = await databaseReady(env.DB);
        return reply({ status: ready ? 'ok' : 'unavailable' }, ready ? 200 : 503);
      } catch { return reply({ status: 'unavailable' }, 503); }
    }
    if (path !== '/internal/database' || request.method !== 'POST' ||
        request.headers.has('Origin') || !authorized(request, env.DATABASE_SECRET)) {
      return reply({ error: 'Not found.' }, 404);
    }
    let statements;
    try { statements = await readStatements(request); }
    catch { return reply({ error: 'Invalid database request.' }, 400); }
    try {
      // D1 batch preserves atomic writes (password changes, grades and their audit entries).
      const result = await env.DB.batch(statements.map(({ sql, params }) => env.DB.prepare(sql).bind(...params)));
      return reply({ result });
    } catch (error) {
      // Never return SQL, student records, or credentials in database error messages.
      if (isDailyDatabaseLimit(error)) {
        const quota = dailyDatabaseLimit();
        return reply({ error: quota.code, retryAt: quota.retryAt }, quota.status, { 'Retry-After': String(quota.retryAfter) });
      }
      const conflict = /unique constraint/i.test(error.message);
      return reply({ error: conflict ? 'UNIQUE_CONSTRAINT' : 'DATABASE_ERROR' }, conflict ? 409 : 502);
    }
  },
};
