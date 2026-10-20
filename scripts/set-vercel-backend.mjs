import fs from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run vercel:backend -- https://bsit-gradeview.YOUR-SUBDOMAIN.workers.dev');
const url = new URL(input);
if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^bsit-gradeview\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)) throw new Error('Use the HTTPS production bsit-gradeview Worker origin, without an API path.');
const directory = new URL('../.local/deployment/', import.meta.url);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(new URL('database-url.txt', directory), url.origin + '\n');
console.log(`Set GRADEVIEW_DATABASE_URL=${url.origin} in Vercel's Production environment. See VERCEL_SETUP.md for the matching secret. The API runs in a Vercel Node function; no API rewrite is needed.`);
