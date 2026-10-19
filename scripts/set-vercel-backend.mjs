import fs from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run vercel:backend -- https://bsit-gradeview.YOUR-SUBDOMAIN.workers.dev');
const url = new URL(input);
if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^bsit-gradeview\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)) throw new Error('Use the HTTPS production bsit-gradeview Worker origin, without an API path.');
const path = new URL('../vercel.json', import.meta.url);
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.rewrites = [
  { source: '/api/:path*', destination: `${url.origin}/api/:path*` },
  ...(config.rewrites || []).filter(rule => rule.source !== '/api/:path*'),
];
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
console.log(`Vercel API routes now target ${url.origin}. Commit and push vercel.json, then run the production smoke check after Vercel redeploys.`);
