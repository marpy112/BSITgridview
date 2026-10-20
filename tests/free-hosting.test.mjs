import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../server/database-worker.js';
import { createRemoteDatabase } from '../server/remote-database.js';
import { applicationUrl, handleVercelRequest } from '../server/vercel-api.js';

const secret = 'a'.repeat(64);
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };
const request = (body, extra = {}) => new Request('https://database.example/internal/database', {
  method: 'POST', headers: { ...headers, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('nested API rewrites preserve student IDs, course codes, and the original route', () => {
  const origin = 'https://bsitgridview.vercel.app';
  for (const path of ['students/5225659', 'students/5225659/records/IT%2001', 'students/5225659/reset-password', 'students/5225659/records/IT%2001/retake']) {
    const target = new URL('/api/index?filter=current', origin);
    target.searchParams.set('__gradeview_path', path);
    const resolved = applicationUrl(target, origin);
    assert.equal(resolved.pathname, '/api/' + path);
    assert.equal(resolved.search, '?filter=current');
    // A runtime that retains the original path must not replace it with query input.
    const original = new URL('/api/' + path + '?__gradeview_path=login', origin);
    assert.equal(applicationUrl(original, origin).pathname, original.pathname);
  }
  const decoded = new URL('/api/index', origin);
  decoded.searchParams.set('__gradeview_path', 'students/5225659/records/IT 01');
  assert.equal(applicationUrl(decoded, origin).pathname, '/api/students/5225659/records/IT%2001');
  for (const path of ['', '../login', 'students/../../login', 'students?id=1', 'students#fragment', 'students\\..\\login']) {
    const target = new URL('/api/index', origin);
    target.searchParams.set('__gradeview_path', path);
    assert.equal(applicationUrl(target, origin), null);
  }
});

test('database gateway rejects missing secrets and malformed/big requests before querying D1', async () => {
  for (const env of [{}, { DATABASE_SECRET: '' }, { DATABASE_SECRET: 'b'.repeat(64) }]) {
    assert.equal((await gateway.fetch(request([]), env)).status, 404);
  }
  for (const input of ['null', '{}', '[]', '{invalid', ' '.repeat(65537),
    [{ sql: 'SELECT ?', params: [{}] }], Array(21).fill({ sql: 'SELECT 1', params: [] })]) {
    assert.equal((await gateway.fetch(request(input), { DATABASE_SECRET: secret })).status, 400);
  }
});

test('remote D1 adapter preserves bindings and batch results and masks database errors', async () => {
  const calls = [];
  const db = createRemoteDatabase('https://database.example', secret, { fetcher: async (url, options) => {
    assert.equal(options.redirect, 'error');
    return gateway.fetch(new Request(url, options), { DATABASE_SECRET: secret, DB: {
      prepare(sql) { return { bind(...params) { calls.push({ sql, params }); return { sql, params }; } }; },
      async batch(statements) {
        if (statements[0].sql === 'FAIL') throw new Error('SQL with private data failed');
        return statements.map(() => ({ success: true, results: [{ value: 42 }], meta: { changes: 1 } }));
      },
    } });
  } });
  assert.equal(await db.prepare('SELECT ? AS value').bind(42).first('value'), 42);
  const batch = await db.batch([db.prepare('INSERT A').bind('a'), db.prepare('INSERT B').bind(null,2)]);
  assert.equal(batch.length, 2);
  assert.equal(batch[1].meta.changes, 1);
  assert.deepEqual(calls[2], { sql: 'INSERT B', params: [null,2] });
  await assert.rejects(db.prepare('FAIL').all(), /^Error: Database request failed\.$/);
});

test('connection requires HTTPS and secret; failed/partial results are never accepted as success', async () => {
  assert.throws(() => createRemoteDatabase('http://database.example', secret));
  assert.throws(() => createRemoteDatabase('https://database.example', ''));
  assert.throws(() => createRemoteDatabase('https://database.example/api', secret));
  for (const result of [[], [{ success: false, results: [] }]]) {
    const db = createRemoteDatabase('https://database.example', secret, { fetcher: async () => Response.json({ result }) });
    await assert.rejects(db.prepare('SELECT 1').all());
  }
});

test('Vercel fails closed without configuration and on preview deployments', async () => {
  const req = new Request('https://bsitgridview.vercel.app/api/health');
  for (const env of [{}, { GRADEVIEW_DATABASE_URL: 'https://database.example', GRADEVIEW_DATABASE_SECRET: secret, VERCEL_ENV: 'preview' }]) {
    const response = await handleVercelRequest(req, env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert(!JSON.stringify(await response.json()).includes(secret));
  }
});

test('alternate Vercel hostnames cannot authorize writes with their own Origin', async () => {
  const response = await handleVercelRequest(new Request('https://preview.vercel.app/api/login', {
    method: 'POST', headers: { Origin: 'https://preview.vercel.app', 'Content-Type': 'application/json' }, body: '{}',
  }), { GRADEVIEW_DATABASE_URL: 'https://database.example', GRADEVIEW_DATABASE_SECRET: secret });
  assert.equal(response.status, 403);
});

test('the exact configured admin branch alias supports login, while other aliases remain denied', async () => {
  const adminOrigin = 'https://bsitgridview-git-main-makis-projects-c74e13c6.vercel.app';
  const env = { GRADEVIEW_DATABASE_URL: 'https://database.example', GRADEVIEW_DATABASE_SECRET: secret, VERCEL_ENV: 'production' };
  for (const [host, origin, expected] of [
    [adminOrigin, adminOrigin, 400],
    ['https://bsitgridview.vercel.app', 'https://bsitgridview.vercel.app', 400],
    ['https://other-branch.vercel.app', 'https://other-branch.vercel.app', 403],
    ['https://bsitgridview.vercel.app', adminOrigin, 403],
  ]) {
    const response = await handleVercelRequest(new Request(host + '/api/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    }), env);
    // A 400 means origin checks passed and the intentionally empty login was validated.
    assert.equal(response.status, expected);
  }
});
