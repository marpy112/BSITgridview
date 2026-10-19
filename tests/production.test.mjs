import test from 'node:test';
import assert from 'node:assert/strict';
import { executeLocal } from './helpers/d1-fixture.mjs';
import worker from '../server/worker.js';

const base = process.env.GRADEVIEW_TEST_URL;
if (!base || !process.env.GRADEVIEW_TEST_CONFIG || !['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Run npm test for an isolated production check.');
const post = (body, contentType = 'application/json') => fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': contentType }, body });

test('health exposes readiness without student information and API responses prevent caching/framing', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert(page.headers.get('Content-Security-Policy')?.includes("script-src 'self'"));
  assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  const session = await fetch(base + '/api/session');
  assert.equal(session.status, 401);
  assert.equal(session.headers.get('Referrer-Policy'), 'no-referrer');
});

test('invalid and oversized login bodies fail before password hashing', async () => {
  for (const body of ['null', '[]', '"text"', '{invalid']) assert.equal((await post(body)).status, 400);
  assert.equal((await post('{}', 'text/plain')).status, 415);
  assert.equal((await post(JSON.stringify({ password: 'é'.repeat(3000) }))).status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"password":"' + 'a'.repeat(4200) + '"}')); controller.close(); } });
  const streamed = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' });
  assert.equal(streamed.status, 413, 'streamed bodies without a declared length are bounded');
  assert.equal((await fetch(base + '/api/session', { headers: { Cookie: 'gradeview_session=bad' } })).status, 401);
});

test('login throttling returns a retry delay before running bcrypt', async () => {
  const identifier = `limit-${crypto.randomUUID()}@example.test`;
  const bucket = Math.floor(Date.now() / 1000 / 900);
  const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`account:admin:${identifier}:${bucket}`))), b => b.toString(16).padStart(2, '0')).join('');
  executeLocal(`INSERT INTO login_attempts(bucket_key,attempts,expires_at) VALUES('${key}',10,${Math.floor(Date.now()/1000)+1800});`);
  try {
    const response = await post(JSON.stringify({ role: 'admin', identifier, password: 'irrelevant' }));
    assert.equal(response.status, 429);
    assert(Number(response.headers.get('Retry-After')) > 0);
  } finally { executeLocal(`DELETE FROM login_attempts WHERE bucket_key='${key}';`); }
});

test('scheduled maintenance only removes expired authentication data', async () => {
  const statements = [];
  const db = { prepare(sql) { return { bind(now) { statements.push({ sql, now }); return this; } }; }, async batch(batch) { assert.equal(batch.length, 2); } };
  await worker.scheduled({}, { DB: db });
  assert.deepEqual(statements.map(item => item.sql), ['DELETE FROM sessions WHERE expires_at<=?', 'DELETE FROM login_attempts WHERE expires_at<=?']);
  assert(statements.every(item => Number.isInteger(item.now)));
});

test('HTTPS API errors retain transport security and cookie-free authentication boundaries', async () => {
  const response = await worker.fetch(new Request('https://gradeview.example/api/session'), { DB: {} });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('only the exact configured Vercel origin can send proxied writes', async () => {
  const env = { DB: {}, APP_ORIGIN: 'https://bsitgridview.vercel.app' };
  for (const origin of [env.APP_ORIGIN, 'https://worker.example']) {
    const response = await worker.fetch(new Request('https://worker.example/api/logout', { method: 'POST', headers: { Origin: origin } }), env);
    assert.equal(response.status, 401, 'allowed origin reaches authentication');
  }
  for (const origin of ['https://bsitgridview.vercel.app.attacker.example', 'https://preview.vercel.app', 'null', '']) {
    const response = await worker.fetch(new Request('https://worker.example/api/logout', { method: 'POST', headers: { Origin: origin } }), env);
    assert.equal(response.status, 403);
  }
  const response = await worker.fetch(new Request('https://worker.example/api/logout', { method: 'POST', headers: { Origin: env.APP_ORIGIN } }), { DB: {} });
  assert.equal(response.status, 403, 'an unset origin cannot authorize external writes');
});
