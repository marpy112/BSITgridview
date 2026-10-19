import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') throw new Error('Create your Cloudflare D1 database and run npm run db:bind -- YOUR_DATABASE_ID before deploying. See CLOUDFLARE_SETUP.md.');
if (config.d1_databases[0].binding !== 'DB') throw new Error('Production requires the DB binding.');
if (config.preview_urls !== false) throw new Error('Disable preview URLs for the production database.');
if (!config.triggers?.crons?.length) throw new Error('Configure scheduled authentication cleanup.');
const headers = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
if (!headers.includes("script-src 'self'") || !headers.includes("frame-ancestors 'none'")) throw new Error('Production security headers are missing.');
