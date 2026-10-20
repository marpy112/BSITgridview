import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const directory = new URL('../.local/deployment/', import.meta.url);
fs.mkdirSync(directory, { recursive: true });
const secretFile = new URL('database-secret.txt', directory);
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
const secret = fs.readFileSync(secretFile, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid saved database secret.');
const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
const { fileURLToPath } = await import('node:url');
const result = spawnSync(process.execPath, [fileURLToPath(wrangler), 'secret', 'put', 'DATABASE_SECRET', '--config', 'wrangler.free.jsonc'], {
  input: secret + '\n', encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
});
if (result.status !== 0) process.exit(result.status || 1);
console.log('Cloudflare database secret saved. Copy .local/deployment/database-secret.txt into the Vercel Production variable GRADEVIEW_DATABASE_SECRET. Do not commit or share this file.');
