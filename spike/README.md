# Spike: client-side TSX compilation from static files

What this proves: a static folder of `.html`, `.js`, `.tsx` files can be served
from any plain static host (GitHub Pages, jsDelivr, `python -m http.server`)
and render a real React app with hooks, multiple components, and cross-file
imports — with no build step, no bundler, no `npm install`, no `node_modules`.

If this works, the whole "serve-any-branch-from-jsDelivr" model in the
architecture is viable without per-branch deploys.

## How it works

1. `index.html` declares an import map so bare specifiers like `react` and
   `react-dom/client` resolve to `esm.sh`.
2. `bootstrap.js` dynamically imports `esbuild-wasm` from jsDelivr.
3. A custom esbuild plugin resolves every relative import by fetching the file
   over HTTP (probing extensions: `.tsx`, `.ts`, `.jsx`, `.js`).
4. Bare imports are marked `external` so the browser's import map handles them.
5. The bundled output is turned into a Blob URL and dynamically imported,
   which runs `ReactDOM.createRoot(...).render(<App />)`.

## Run locally

Any static server works. From this directory:

```bash
python -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000/`.

First boot: ~1–3 s (downloads esbuild-wasm, compiles). Subsequent page loads
reuse the browser's HTTP cache for the wasm and source files.

## Deploy to GitHub Pages

Push this folder to any GitHub repo, enable Pages on the branch + subfolder,
done. No build step in the Pages config.

## View a feature branch without deploying

Once pushed, any branch is viewable via jsDelivr:

```
https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/spike-client-compile/index.html
```

That URL serves the exact files on that branch, with correct MIME types, no
deploy step. This is the mechanism the product will use to expose proposed
changes to visitors for voting.

After pushing to a branch, purge the jsDelivr cache so the preview is fresh:

```
https://purge.jsdelivr.net/gh/<owner>/<repo>@<branch>/spike-client-compile/index.html
```

## Known constraints (informs the AI's output spec later)

- Imports must use relative paths (`./Foo`) or bare specifiers in the import
  map. No `@/` aliases, no path mapping.
- Dependencies come from `esm.sh` (or equivalent) via the import map. No
  `node_modules`. CJS-only packages will not work.
- No Babel plugins, no decorators, no CSS-in-JS that needs a build.
- Assets (`/images/foo.png`) must be relative (`./images/foo.png`) so they
  resolve correctly when served from jsDelivr's branch URL.

## What's next

- Cache the compiled bundle in IndexedDB keyed by the source-tree hash, so
  repeat visits skip compilation entirely.
- Add CSS handling (inject `<style>` tags from imported `.css` files).
- Prove the jsDelivr branch-serving path end to end by pushing a branch and
  hitting the CDN URL.
- Drop the widget on top of this scaffold.
