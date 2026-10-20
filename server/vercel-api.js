import worker from './worker.js';
import { createRemoteDatabase } from './remote-database.js';

export async function handleVercelRequest(request, environment = process.env) {
  let db;
  try {
    // Production database credentials belong only in Vercel's Production environment.
    if (environment.VERCEL_ENV && environment.VERCEL_ENV !== 'production') throw new Error();
    db = createRemoteDatabase(environment.GRADEVIEW_DATABASE_URL, environment.GRADEVIEW_DATABASE_SECRET, {
      allowLocal: !environment.VERCEL && environment.NODE_ENV === 'test',
    });
  } catch {
    return Response.json({ error: 'The database connection is not configured.' }, { status: 503, headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000',
    } });
  }
  const appOrigin = environment.APP_ORIGIN || 'https://bsitgridview.vercel.app';
  // Keep the existing exact-origin write checks, even on alternate Vercel hostnames.
  const original = new URL(request.url);
  const url = new URL(original.pathname + original.search, appOrigin);
  const headers = new Headers(request.headers);
  // Vercel overwrites x-forwarded-for. Ignore a client-supplied Cloudflare IP header.
  headers.set('CF-Connecting-IP', request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local');
  const forwarded = new Request(url, {
    method: request.method, headers, body: request.body,
    ...(request.body ? { duplex: 'half' } : {}),
  });
  return worker.fetch(forwarded, { DB: db, APP_ORIGIN: appOrigin });
}
