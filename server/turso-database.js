import { createClient as createWebClient } from '@libsql/client/web';

export function wrapTursoClient(client) {
  function result(value) {
    return { success: true, results: value.rows.map(row => Object.fromEntries(value.columns.map(column => [column, row[column]]))),
      meta: { changes: value.rowsAffected } };
  }
  async function execute(operation) {
    try { return await operation(); }
    catch (error) {
      if (/SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)/.test(error.code || '') || /unique constraint/i.test(error.message || '')) throw new Error('Unique constraint violation.');
      throw Object.assign(new Error('The database service is temporarily unavailable. Please try again later.'), { status: 503 });
    }
  }
  function prepare(sql, params = []) {
    return { sql, params,
      bind(...values) { return prepare(sql, values); },
      async all() { return execute(async () => result(await client.execute({ sql, args: params }))); },
      async run() { return this.all(); },
      async first(column) { const row = (await this.all()).results[0]; return row ? (column === undefined ? row : row[column]) : null; },
    };
  }
  return { prepare,
    batch(statements) { return execute(async () => (await client.batch(statements.map(({ sql, params }) => ({ sql, args: params })), 'write')).map(result)); },
    close() { client.close(); },
  };
}

export async function createTursoDatabase(input, token, { allowFile = false } = {}) {
  const url = new URL(input);
  if (allowFile && url.protocol === 'file:') {
    const { createClient } = await import('@libsql/client');
    return wrapTursoClient(createClient({ url: url.href, intMode: 'number', timeout: 5000 }));
  }
  if (!['libsql:', 'https:'].includes(url.protocol) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.turso\.io$/i.test(url.hostname) ||
      url.username || url.password || url.port || !['', '/'].includes(url.pathname) || url.search || url.hash || typeof token !== 'string' || !token.trim() || /\s/.test(token)) throw new Error('Invalid Turso configuration.');
  // HTTP avoids long-lived WebSocket connections in a Vercel function.
  const client = createWebClient({ url: `https://${url.host}`, authToken: token, intMode: 'number',
    fetch: (request, options) => fetch(request, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }),
  });
  return wrapTursoClient(client);
}
