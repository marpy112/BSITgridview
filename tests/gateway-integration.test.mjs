import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteDatabase } from '../server/remote-database.js';

const origin = process.env.GRADEVIEW_GATEWAY_URL;
if (!origin || !process.env.GRADEVIEW_TEST_CONFIG || new URL(origin).hostname !== '127.0.0.1') throw new Error('Use npm run test:free with an isolated database.');
const db = createRemoteDatabase(origin, process.env.GRADEVIEW_DATABASE_SECRET, { allowLocal: true });

test('remote database batches roll back all writes after a constraint failure', async () => {
  await db.prepare('CREATE TABLE gateway_transaction_test (id INTEGER PRIMARY KEY, value TEXT)').run();
  try {
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO gateway_transaction_test VALUES (?,?)').bind(1,'first'),
      db.prepare('INSERT INTO gateway_transaction_test VALUES (?,?)').bind(1,'duplicate'),
    ]), /Unique constraint/);
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM gateway_transaction_test').first('count'), 0);
  } finally { await db.prepare('DROP TABLE gateway_transaction_test').run(); }
});

test('direct database requests cannot bypass the secret or use the browser origin', async () => {
  for (const headers of [{}, { Authorization: `Bearer ${'0'.repeat(64)}` }, {
    Authorization: `Bearer ${process.env.GRADEVIEW_DATABASE_SECRET}`, Origin: 'https://bsitgridview.vercel.app',
  }]) {
    const response = await fetch(origin + '/internal/database', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify([{ sql: 'SELECT 1', params: [] }]),
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});
