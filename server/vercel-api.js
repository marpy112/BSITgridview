import worker from './worker.js';
import { createRemoteDatabase } from './remote-database.js';
import { createTursoDatabase } from './turso-database.js';

export function applicationUrl(original, origin) {
  const url = new URL(original.pathname + original.search, origin);
  // Vite's standalone API functions need an explicit rewrite for nested routes.
  // Support runtimes that expose either the original URL or the rewrite target.
  if (url.pathname === '/api/index' && url.searchParams.has('__gradeview_path')) {
    const path = url.searchParams.get('__gradeview_path');
    if (!path || path.split('/').some(part => part === '.' || part === '..') || /[?#\\\u0000-\u001f\u007f]/.test(path)) return null;
    url.pathname = '/api/' + path;
  }
  url.searchParams.delete('__gradeview_path');
  return url;
}

export async function handleVercelRequest(request, environment = process.env) {
  let db;
  try {
    // Production database credentials belong only in Vercel's Production environment.
    if (environment.VERCEL_ENV && environment.VERCEL_ENV !== 'production') throw new Error();
    const localTest = !environment.VERCEL && environment.NODE_ENV === 'test';
    const provider = environment.GRADEVIEW_DATABASE_PROVIDER || 'cloudflare';
    if (provider === 'turso') db = await createTursoDatabase(environment.TURSO_DATABASE_URL, environment.TURSO_AUTH_TOKEN, { allowFile: localTest });
    else if (provider === 'cloudflare') db = createRemoteDatabase(environment.GRADEVIEW_DATABASE_URL, environment.GRADEVIEW_DATABASE_SECRET, { allowLocal: localTest });
    else throw new Error('Unknown database provider.');
  } catch {
    return Response.json({ error: 'The database connection is not configured.' }, { status: 503, headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000',
    } });
  }
  const appOrigin = environment.APP_ORIGIN || 'https://bsitgridview.vercel.app';
  const original = new URL(request.url);
  // The owner also uses this exact production branch alias for administrator login.
  // Other deployment hosts still use the canonical origin and cannot authorize writes.
  const adminBranchOrigin = 'https://bsitgridview-git-main-makis-projects-c74e13c6.vercel.app';
  const servedOrigin = original.origin === adminBranchOrigin ? adminBranchOrigin : appOrigin;
  const url = applicationUrl(original, servedOrigin);
  if (!url) { db.close?.(); return Response.json({ error: 'API endpoint not found.' }, { status: 404, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000',
  } }); }
  const headers = new Headers(request.headers);
  // Vercel overwrites x-forwarded-for. Ignore a client-supplied Cloudflare IP header.
  headers.set('CF-Connecting-IP', request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local');
  const forwarded = new Request(url, {
    method: request.method, headers, body: request.body,
    ...(request.body ? { duplex: 'half' } : {}),
  });
  try { return await worker.fetch(forwarded, { DB: db, APP_ORIGIN: servedOrigin }); }
  finally { db.close?.(); }
}
