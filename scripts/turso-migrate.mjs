import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client/web';
import { createTursoDatabase } from '../server/turso-database.js';

const migrationDirectory = new URL('../migrations/', import.meta.url);

export async function readMigrations() {
  const names = (await fs.readdir(migrationDirectory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async name => ({ name, sql: await fs.readFile(new URL(name, migrationDirectory), 'utf8') })));
}

export async function migrationPlan(client, migrations) {
  if ((await client.execute('PRAGMA foreign_keys')).rows[0][0] !== 1) throw new Error('Foreign keys must be enabled.');
  const applied = (await client.execute('SELECT name FROM d1_migrations ORDER BY id')).rows.map(row => row.name);
  // This upgrades an existing installation. Initial creation/import keeps its own workflow.
  if (applied.length < 11 || applied.some((name, index) => name !== migrations[index]?.name)) {
    throw new Error('Migration history does not match this release.');
  }
  return migrations.slice(applied.length);
}

export async function applyMigrations(client, migrations) {
  const transaction = await client.transaction('write');
  try {
    // Recheck while holding the write transaction so simultaneous runners cannot apply twice.
    const pending = await migrationPlan(transaction, migrations);
    if (pending.length) {
      // Filenames are restricted above; scripts and history are committed in the same transaction.
      await transaction.executeMultiple(pending.map(({ name, sql }) =>
        `${sql}\nINSERT INTO d1_migrations(name) VALUES('${name}');`).join('\n'));
      if ((await transaction.execute('PRAGMA foreign_key_check')).rows.length) throw new Error('Foreign key verification failed.');
    }
    await transaction.commit();
    return pending.map(migration => migration.name);
  } finally {
    // Closing an uncommitted transaction rolls back its schema and history changes together.
    transaction.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--plan', '--apply'].includes(arg))) {
    console.error('Usage: npm run turso:migrate -- [--plan | --apply]. Default: read-only plan. Back up the database before --apply.');
    process.exitCode = 1;
    return;
  }
  let client;
  try {
    // Match the application's HTTPS host and credential validation; never print SDK errors.
    const checked = await createTursoDatabase(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN);
    checked.close();
    const url = new URL(process.env.TURSO_DATABASE_URL);
    client = createClient({ url: `https://${url.host}`, authToken: process.env.TURSO_AUTH_TOKEN,
      intMode: 'number', fetch: (request, options) => fetch(request, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
      }),
    });
    const migrations = await readMigrations();
    if (args.includes('--apply')) {
      const applied = await applyMigrations(client, migrations);
      console.log(applied.length ? `Applied migrations atomically:\n${applied.join('\n')}` : 'Database is already current.');
    } else {
      const pending = await migrationPlan(client, migrations);
      console.log(pending.length ? `Pending migrations (no changes made):\n${pending.map(item => item.name).join('\n')}` : 'Database is current (no changes made).');
    }
  } catch {
    console.error('Migration could not complete or verify. Check the configured database, migration history and foreign keys. Run --plan before retrying; no website deployment was performed.');
    process.exitCode = 1;
  } finally { client?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
