// Local HTTP adapter for exercising the production Fetch entry point in integration tests.
import http from 'node:http';
import fs from 'node:fs/promises';
import entry from '../api/[...path].js';

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    let response;
    if (incoming.url.startsWith('/api/')) {
      const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined : incoming;
      response = await entry.fetch(new Request(new URL(incoming.url, origin), {
        method: incoming.method, headers: incoming.headers, body, ...(body ? { duplex: 'half' } : {}),
      }));
    } else {
      response = new Response(await fs.readFile('dist/index.html'), { headers: { 'Content-Type': 'text/html',
        'Content-Security-Policy': "script-src 'self'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
      } });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end('Test server failed.');
  }
});
server.listen(0, '127.0.0.1', () => {
  process.env.APP_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  console.log(`TEST_API=${process.env.APP_ORIGIN}`);
});
