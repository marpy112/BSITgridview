import fs from 'node:fs';
const id = process.argv[2];
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') || /^0{8}-/.test(id)) throw new Error('Pass the database_id returned by Cloudflare D1.');
for (const name of ['wrangler.jsonc', 'wrangler.free.jsonc']) {
  const path = new URL(`../${name}`, import.meta.url);
  const config = JSON.parse(fs.readFileSync(path, 'utf8'));
  config.d1_databases[0].database_id = id;
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}
console.log('Updated the D1 database binding in both Wrangler configurations.');
