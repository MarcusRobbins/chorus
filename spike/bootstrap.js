// Bootstrap: fetch .tsx source over HTTP, bundle with esbuild-wasm in the
// browser, run the result. No build step. React comes from esm.sh via the
// import map in index.html.

import * as esbuild from 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.23.0/esm/browser.min.js';

const ENTRY = './src/main.tsx';
const ESBUILD_VERSION = '0.23.0';
const WASM_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`;

const statusEl = document.getElementById('boot-status');
const setStatus = (msg, isError = false) => {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
};

// Bare specifiers (react, react-dom/client) are resolved by the browser's
// import map, not by the bundler.
const isBare = (p) => !p.startsWith('.') && !p.startsWith('/') && !p.startsWith('http');

// Cache fetch results so probing + loading the same file does not double-fetch.
const fetchCache = new Map();
async function fetchText(url) {
  if (fetchCache.has(url)) return fetchCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      fetchCache.set(url, null);
      return null;
    }
    const text = await res.text();
    fetchCache.set(url, text);
    return text;
  } catch {
    fetchCache.set(url, null);
    return null;
  }
}

// Resolve a relative import to an actual URL, probing extensions and index files.
async function probe(url) {
  const hasExt = /\.(tsx?|jsx?|css|json)$/.test(new URL(url).pathname);
  if (hasExt) {
    if ((await fetchText(url)) !== null) return url;
  }
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    if ((await fetchText(url + ext)) !== null) return url + ext;
  }
  for (const seg of ['/index.tsx', '/index.ts', '/index.jsx', '/index.js']) {
    if ((await fetchText(url + seg)) !== null) return url + seg;
  }
  throw new Error(`Cannot resolve import: ${url}`);
}

const httpPlugin = {
  name: 'http',
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.kind === 'entry-point') {
        return { path: new URL(args.path, location.href).href, namespace: 'http' };
      }
      if (isBare(args.path)) {
        // Leave to the import map.
        return { path: args.path, external: true };
      }
      const base = new URL(args.path, args.importer);
      const resolved = await probe(base.href);
      return { path: resolved, namespace: 'http' };
    });

    build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
      const text = await fetchText(args.path);
      if (text === null) throw new Error(`Fetch failed: ${args.path}`);
      const m = args.path.match(/\.(tsx|ts|jsx|js)$/);
      const loader = m ? m[1] : 'js';
      return { contents: text, loader };
    });
  },
};

async function main() {
  setStatus('Initialising compiler…');
  await esbuild.initialize({ wasmURL: WASM_URL });

  setStatus('Compiling source…');
  const t0 = performance.now();
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    plugins: [httpPlugin],
    write: false,
    logLevel: 'silent',
  });
  const ms = Math.round(performance.now() - t0);

  if (result.errors.length) {
    throw new Error(result.errors.map((e) => e.text).join('\n'));
  }

  const bundled = result.outputFiles[0].text;
  const blob = new Blob([bundled], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  setStatus(`Compiled in ${ms} ms. Running…`);
  await import(url);
  setStatus(`Ready · compiled in ${ms} ms · ${(bundled.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message ?? err}`, true);
});
