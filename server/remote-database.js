import { dailyDatabaseLimit } from './database-errors.js';

export function createRemoteDatabase(origin, secret, { fetcher = fetch, allowLocal = false } = {}) {
  const url = new URL(origin);
  const local = allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('Invalid database connection configuration.');
  const endpoint = new URL('/internal/database', url);
  async function batch(statements) {
    const response = await fetcher(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(statements.map(({ sql, params }) => ({ sql, params }))),
      signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store',
    });
    const data = await response.json();
    if (response.status === 503 && data.error === 'DATABASE_DAILY_LIMIT') throw dailyDatabaseLimit();
    if (!response.ok || !Array.isArray(data.result) || data.result.length !== statements.length ||
        data.result.some(item => item.success !== true || !Array.isArray(item.results))) {
      throw new Error(response.status === 409 && data.error === 'UNIQUE_CONSTRAINT'
        ? 'Unique constraint violation.' : 'Database request failed.');
    }
    return data.result;
  }
  function prepare(sql, params = []) {
    return {
      sql, params,
      bind(...values) { return prepare(sql, values); },
      async all() { return (await batch([this]))[0]; },
      async run() { return (await batch([this]))[0]; },
      async first(column) {
        const row = (await this.all()).results[0];
        return row ? (column === undefined ? row : row[column]) : null;
      },
    };
  }
  return { prepare, batch };
}
