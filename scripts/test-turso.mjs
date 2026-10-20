import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';

const directory = fs.mkdtempSync(path.resolve('.local/turso-tests-'));
const url = pathToFileURL(path.join(directory, 'test.db')).href;
const client = createClient({ url });
try {
  for (const file of fs.readdirSync('migrations').filter(file => file.endsWith('.sql')).sort()) await client.executeMultiple(fs.readFileSync(path.join('migrations', file), 'utf8'));
} finally { client.close(); }
const env = { ...process.env, NODE_ENV: 'test', GRADEVIEW_DATABASE_PROVIDER: 'turso', TURSO_DATABASE_URL: url,
  GRADEVIEW_TURSO_TEST_URL: url, GRADEVIEW_TEST_CONFIG: 'isolated-turso-file' };
delete env.VERCEL; delete env.VERCEL_ENV;
const server = spawn(process.execPath, ['scripts/serve-vercel-test.mjs'], { env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
let output = ''; server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
try {
  let base;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Isolated Turso API failed to start.');
    base = output.match(/TEST_API=(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (base) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!base) throw new Error('Isolated Turso API did not start.');
  console.log('Testing the actual Vercel entry point with isolated libSQL data; hosted records are untouched.');
  const result = spawnSync(process.execPath, ['--test','--test-concurrency=1','tests/database.test.mjs','tests/onboarding.test.mjs','tests/admin-management.test.mjs','tests/admin-tools.test.mjs','tests/transfer-students.test.mjs','tests/retakes.test.mjs','tests/production.test.mjs','tests/pdf-export.test.mjs'], { env: { ...env, GRADEVIEW_TEST_URL: base }, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} finally { server.kill(); }
