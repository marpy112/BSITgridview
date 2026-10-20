import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { inspectSource, importCopy, verifyCopy } from './turso-transfer.mjs';
import { createTursoDatabase } from '../server/turso-database.js';

const args = process.argv.slice(2);
const filename = args[args.indexOf('--source') + 1];
if (!args.includes('--source') || !filename || filename.startsWith('--')) throw new Error('Usage: npm run turso:import -- --source backups/fresh-export.sql [--plan | --verify-only]');
const directory = await fs.mkdtemp(path.resolve('.local/turso-import-'));
const source = createClient({ url: pathToFileURL(path.join(directory, 'source.db')).href, concurrency: 1 });
let target;
try {
  // The SQL export stays local. Only parameterized application data goes to Turso.
  const dump = await fs.readFile(filename, 'utf8');
  if (/^(?:BEGIN|COMMIT|ROLLBACK)\b/m.test(dump)) throw new Error('Use a Cloudflare D1 SQL export without explicit transactions.');
  await source.executeMultiple('PRAGMA foreign_keys=OFF; BEGIN;\n' + dump + '\nCOMMIT; PRAGMA foreign_keys=ON;');
  const snapshot = await inspectSource(source);
  const counts = Object.fromEntries(snapshot.tables.map(table => [table.name, table.rows.length]));
  if (args.includes('--plan')) console.log('Verified private source; migration counts:', JSON.stringify(counts));
  else {
    // Validate exactly the same credentials and host rules as the application.
    const checked = await createTursoDatabase(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN);
    checked.close();
    const url = new URL(process.env.TURSO_DATABASE_URL);
    target = createClient({ url: `https://${url.host}`, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
    const verified = args.includes('--verify-only') ? await verifyCopy(snapshot, target) : await importCopy(snapshot, target);
    console.log('Verified target counts and every saved field:', JSON.stringify(verified));
    console.log('Passwords and grades preserved. Existing sessions were not copied; users sign in again. Vercel has not been switched.');
  }
} catch {
  // SDK errors can contain SQL or URLs; keep credentials and records out of logs.
  console.error('Migration did not complete or verify. Keep Vercel on the original database. Check the source backup, empty target, and private Turso credentials.');
  process.exitCode = 1;
} finally { source.close(); target?.close(); }
