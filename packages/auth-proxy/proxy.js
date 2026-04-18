// GitHub OAuth device-flow proxy.
//
// GitHub's github.com/login/device/code and github.com/login/oauth/access_token
// endpoints do not return CORS headers, so a browser cannot call them
// directly. This is a minimal forwarder that adds CORS. It does not look at
// or persist the tokens it proxies — they pass straight through.
//
// Run locally: `node proxy.js`
// Deploy: the handler function is small and translates to a Cloudflare
// Worker / Deno Deploy / Vercel Edge Function unchanged.

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const UA = 'oss-kanban-auth-proxy/0.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

const routes = {
  '/device/code':  'https://github.com/login/device/code',
  '/oauth/token':  'https://github.com/login/oauth/access_token',
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const target = routes[req.url];
  if (!target) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readBody(req);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      ...CORS,
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    res.end(text);
    console.log(`${new Date().toISOString()} ${req.url} → ${upstream.status}`);
  } catch (err) {
    res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_failed', message: String(err) }));
    console.error(`${new Date().toISOString()} ${req.url} → error`, err);
  }
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

server.listen(PORT, () => {
  console.log(`auth proxy listening on http://localhost:${PORT}`);
  console.log(`  POST /device/code  → ${routes['/device/code']}`);
  console.log(`  POST /oauth/token  → ${routes['/oauth/token']}`);
});
