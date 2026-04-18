// GitHub OAuth device-flow proxy — Cloudflare Worker version.
//
// GitHub's github.com/login/device/code and github.com/login/oauth/access_token
// endpoints do not return CORS headers, so a browser cannot call them
// directly. This Worker forwards those two endpoints with CORS added. It does
// not inspect, log, or persist the token body — requests pass straight through.
//
// Deploy: paste this file's contents into a new Worker on the Cloudflare
// dashboard ("Workers & Pages" → "Create" → "Start with Hello World!" →
// replace the editor contents → Deploy).
//
// Once deployed you'll get a URL like:
//   https://<your-worker-name>.<subdomain>.workers.dev
// Set that URL as data-github-auth-proxy on the widget script tag.

const UA = 'oss-kanban-auth-proxy/0.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

const routes = {
  '/device/code': 'https://github.com/login/device/code',
  '/oauth/token': 'https://github.com/login/oauth/access_token',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const target = routes[url.pathname];
    if (!target) {
      return json({ error: 'not_found' }, 404);
    }

    const body = await request.text();

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
      return new Response(text, {
        status: upstream.status,
        headers: {
          ...CORS,
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
        },
      });
    } catch (err) {
      return json({ error: 'upstream_failed', message: String(err) }, 502);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
