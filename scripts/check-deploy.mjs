import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') throw new Error('Create your Cloudflare D1 database and run npm run db:bind -- YOUR_DATABASE_ID before deploying. See CLOUDFLARE_SETUP.md.');
