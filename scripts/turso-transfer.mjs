import { createHash } from 'node:crypto';

// Dependency order preserves foreign keys, including retake history and audits.
export const tables = ['students', 'courses', 'accounts', 'progress_records', 'record_audit', 'academic_calendar', 'admin_events', 'instructors', 'course_attempts', 'enrollment_source_records', 'd1_migrations', 'sessions', 'login_attempts'];
const transient = new Set(['sessions', 'login_attempts']);
const quote = name => '"' + name.replaceAll('"', '""') + '"';

export async function inspectSource(client) {
  const integrity = await client.execute('PRAGMA integrity_check');
  if (integrity.rows.length !== 1 || integrity.rows[0][0] !== 'ok') throw new Error('Source database integrity check failed.');
  if ((await client.execute('PRAGMA foreign_key_check')).rows.length) throw new Error('Source database has broken foreign keys.');
  const catalog = (await client.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index') AND name NOT LIKE 'sqlite_%'")).rows;
  const unexpected = catalog.filter(row => row.type === 'table' && !tables.includes(row.name));
  if (unexpected.length) throw new Error('Source contains unexpected tables; review them before migration.');
  const snapshot = [];
  for (const name of tables) {
    const schema = catalog.find(row => row.type === 'table' && row.name === name);
    if (!schema) { if (['d1_migrations', 'enrollment_source_records'].includes(name)) continue; throw new Error(`Source is missing the required ${name} table.`); }
    const columns = (await client.execute(`PRAGMA table_info(${quote(name)})`)).rows;
    const primary = columns.filter(column => column.pk).sort((a,b) => a.pk - b.pk).map(column => quote(column.name));
    const order = primary.length ? primary.join(',') : 'rowid';
    const data = transient.has(name) ? { columns: columns.map(column => column.name), rows: [] }
      : await client.execute(`SELECT * FROM ${quote(name)} ORDER BY ${order}`);
    const rows = data.rows.map(row => data.columns.map(column => row[column]));
    snapshot.push({ name, sql: schema.sql, columns: data.columns, rows, order,
      hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') });
  }
  const records = snapshot.find(table => table.name === 'progress_records');
  for (const column of ['transfer_school','attempt_no','version','operation_id']) if (!records.columns.includes(column)) throw new Error('Source backup predates the current grade schema. Take a fresh export.');
  const accounts = snapshot.find(table => table.name === 'accounts');
  const role = accounts.columns.indexOf('role');
  if (!accounts.rows.some(row => row[role] === 'admin')) throw new Error('Source has no administrator account.');
  return { tables: snapshot, indexes: catalog.filter(row => row.type === 'index' && tables.includes(row.tbl_name)).map(row => row.sql) };
}

export async function verifyCopy(snapshot, client) {
  if ((await client.execute('PRAGMA foreign_keys')).rows[0][0] !== 1) throw new Error('Target must enforce foreign keys. Use a libSQL-compatible Turso database.');
  if ((await client.execute('PRAGMA foreign_key_check')).rows.length) throw new Error('Target has broken foreign keys.');
  for (const table of snapshot.tables) {
    const result = await client.execute(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)} ORDER BY ${table.order}`);
    const values = result.rows.map(row => result.columns.map(column => row[column]));
    if (createHash('sha256').update(JSON.stringify(values)).digest('hex') !== table.hash) throw new Error(`Verification failed for ${table.name}. Keep Vercel on the original database.`);
  }
  return Object.fromEntries(snapshot.tables.map(table => [table.name, table.rows.length]));
}

export async function importCopy(snapshot, client) {
  const existing = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'")).rows;
  if (existing.length) throw new Error('Target is not empty. Import refused; existing data was not overwritten. Use verify-only for an already imported database.');
  if ((await client.execute('PRAGMA foreign_keys')).rows[0][0] !== 1) throw new Error('Target must enforce foreign keys. Use a libSQL-compatible Turso database.');
  const statements = snapshot.tables.map(table => table.sql);
  for (const table of snapshot.tables) {
    const size = Math.min(50, Math.floor(900 / table.columns.length));
    for (let start = 0; start < table.rows.length; start += size) {
      const rows = table.rows.slice(start, start + size);
      const placeholders = '(' + table.columns.map(() => '?').join(',') + ')';
      statements.push({ sql: `INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES ${rows.map(() => placeholders).join(',')}`, args: rows.flat() });
    }
  }
  statements.push(...snapshot.indexes);
  await client.batch(statements, 'write');
  return verifyCopy(snapshot, client);
}
