import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') throw new Error('Create your Cloudflare D1 database and run npm run db:bind -- YOUR_DATABASE_ID before deploying. See VERCEL_SETUP.md.');
if (config.d1_databases[0].binding !== 'DB') throw new Error('Production requires the DB binding.');
if (config.preview_urls !== false) throw new Error('Disable preview URLs for the production database.');
if (!config.triggers?.crons?.length) throw new Error('Configure scheduled authentication cleanup.');
const free = JSON.parse(fs.readFileSync(new URL('../wrangler.free.jsonc', import.meta.url), 'utf8'));
if (free.main !== 'server/database-worker.js' || free.limits || free.assets) throw new Error('Free Worker must only run the database gateway, without paid CPU settings.');
if (JSON.stringify(free.d1_databases) !== JSON.stringify(config.d1_databases)) throw new Error('Free and local/paid configurations must use the same existing database.');
if (free.preview_urls !== false || !free.triggers?.crons?.length) throw new Error('Free Worker requires authentication cleanup and disabled preview URLs.');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const apiRewrites = vercel.rewrites?.filter(rule => rule.source.startsWith('/api')) || [];
if (apiRewrites.length !== 1 || apiRewrites[0].source !== '/api/:path*' || apiRewrites[0].destination !== '/api/index?__gradeview_path=:path*') throw new Error('Vercel must route all API path depths to the local Node function.');
if (!fs.existsSync(new URL('../api/index.js', import.meta.url))) throw new Error('The Vercel API function is missing.');
const headers = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
if (!headers.includes("script-src 'self'") || !headers.includes("frame-ancestors 'none'")) throw new Error('Production security headers are missing.');
const vercelHeaders = vercel.headers?.find(rule => rule.source === '/(.*)')?.headers || [];
const csp = vercelHeaders.find(header => header.key.toLowerCase() === 'content-security-policy')?.value;
if (!csp || !headers.includes(`Content-Security-Policy: ${csp}`) || !csp.includes("worker-src 'self' blob:")) {
  throw new Error('Vercel and Worker security policies must agree and permit the bundled PDF worker.');
}
for (const [key, value] of [['X-Content-Type-Options', 'nosniff'], ['X-Frame-Options', 'DENY'], ['Referrer-Policy', 'no-referrer']]) {
  if (!vercelHeaders.some(header => header.key === key && header.value === value)) throw new Error(`Missing production header: ${key}.`);
}
if (!vercel.headers?.some(rule => rule.source === '/api/:path*' && rule.headers.some(header => header.key === 'Cache-Control' && header.value === 'no-store'))) {
  throw new Error('Authenticated API responses must not be cached.');
}
if (vercel.buildCommand !== 'npm run build:production') throw new Error('Vercel must run the production preflight after building.');
const ignore = fs.readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8').split(/\r?\n/);
for (const entry of ['.local/', '.wrangler/', 'backups/', '.env', '.env.*', '.dev.vars', '.dev.vars.*']) {
  if (!ignore.includes(entry)) throw new Error(`Exclude private deployment input from uploads: ${entry}.`);
}
for (const name of ['0012_certificates.sql', '0013_certificate_batches.sql', '0014_student_certificates.sql']) {
  if (!fs.existsSync(new URL(`../migrations/${name}`, import.meta.url))) throw new Error(`Required certificate migration is missing: ${name}.`);
}
for (const directory of ['api', 'server', 'shared', 'scripts']) {
  for (const file of fs.readdirSync(path.join(root, directory), { recursive: true })) {
    if (/\.(?:mjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, directory, file)], { stdio: 'pipe' });
  }
}
if (process.argv.includes('--assets')) {
  const dist = path.join(root, 'dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const files = fs.readdirSync(dist, { recursive: true });
  if (!files.some(file => /pdf\.worker\.min-[\w-]+\.mjs$/.test(file))) throw new Error('The certificate preview worker is missing from the build.');
  for (const [, reference] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
    if (!fs.existsSync(path.join(dist, reference.slice(1)))) throw new Error('The production page references a missing asset.');
  }
  for (const file of files) {
    if (file.endsWith('.map')) throw new Error('Do not publish source maps in the student portal.');
    if (!/\.(?:js|mjs|html|css)$/.test(file)) continue;
    const content = fs.readFileSync(path.join(dist, file), 'utf8');
    if (/TURSO_AUTH_TOKEN|GRADEVIEW_DATABASE_SECRET|password_hash|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      throw new Error('Server-only data was found in a public build asset.');
    }
  }
}
console.log('Production preflight passed: routing, security headers, private-file exclusions, migrations, syntax and requested build assets.');
