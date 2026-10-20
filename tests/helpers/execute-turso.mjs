import fs from 'node:fs';
import { createClient } from '@libsql/client';
const url = process.env.GRADEVIEW_TURSO_TEST_URL;
if (!url?.startsWith('file:') || !process.env.GRADEVIEW_TEST_CONFIG) throw new Error('An isolated local test database is required.');
const client = createClient({ url, timeout: 5000 });
try {
  const sql = fs.readFileSync(0, 'utf8');
  if (process.env.GRADEVIEW_TEST_QUERY === '1') {
    const result = await client.execute(sql);
    console.log(JSON.stringify([{ results: result.rows.map(row => Object.fromEntries(result.columns.map(column => [column, row[column]]))) }]));
  } else await client.executeMultiple(sql);
}
finally { client.close(); }
