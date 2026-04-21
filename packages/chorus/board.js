// 2D Figma-style canvas for exploring all pages of the CURRENT branch.
// Unlike canvas.js (full-viewport overlay, 3D Three.js scene, grid of
// branches × pages), this one:
//
//   - lives INSIDE the preview-iframe's space rather than covering the
//     whole page, so the chorus panel and phylogeny are still visible,
//   - is flat (d3-zoom, no Three.js),
//   - only shows pages for ONE branch — the branch currently selected.
//
// Pan by dragging the background (or any tile header). Wheel to zoom.
// Click a tile header to fly to it. Click a link inside any tile to
// spawn a new tile for that page — same branch, different URL.

import { zoom as d3Zoom, zoomIdentity } from 'https://esm.sh/d3-zoom@3';
import { select as d3Select } from 'https://esm.sh/d3-selection@3';
import 'https://esm.sh/d3-transition@3';

const TILE_W = 900;
const TILE_H = 560;
const TILE_GAP = 80;

export async function createBoard({
  hostRoot,           // ShadowRoot to attach the container to
  branchName,         // the branch to board
  initialPath,        // first page to show
  previewUrlFor,      // (branchName, path) => url
  onClose,            // () => void
}) {
  // Container mirrors preview.js applyMode(windowed) positioning so it
  // lands in exactly the iframe's slot. CSS vars chorus-iframe-width /
  // chorus-top-height are set by the outer panel's resize logic; we
  // re-use them directly so the board resizes in lockstep.
  const container = document.createElement('div');
  container.className = 'chorus-board';
  hostRoot.appendChild(container);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'chorus-board-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close board (Esc)';
  container.appendChild(closeBtn);
  closeBtn.addEventListener('click', () => { destroy(); onClose?.(); });

  const hint = document.createElement('div');
  hint.className = 'chorus-board-hint';
  hint.textContent =
    'All pages on ' + branchName + ' · Drag to pan · Wheel to zoom · Click a link to spawn a new tile';
  container.appendChild(hint);

  // d3-zoom applies a translate+scale transform to this inner wrapper.
  const inner = document.createElement('div');
  inner.className = 'chorus-board-inner';
  container.appendChild(inner);

  // Tiles are laid out in a horizontal row. tiles[] owns the per-page
  // state; addPage is idempotent on path, so clicking a link back to a
  // page we already have just flies there.
  const tiles = [];
  function makeTile(path, col) {
    const el = document.createElement('div');
    el.className = 'chorus-board-tile';
    el.style.width = TILE_W + 'px';
    el.style.height = TILE_H + 'px';
    el.style.left = col * (TILE_W + TILE_GAP) + 'px';
    el.style.top = '0px';

    const hdr = document.createElement('div');
    hdr.className = 'chorus-board-tile-hdr';
    hdr.textContent = path;
    el.appendChild(hdr);

    const iframe = document.createElement('iframe');
    iframe.src = previewUrlFor(branchName, path);
    iframe.className = 'chorus-board-tile-frame';
    el.appendChild(iframe);

    // Tell the inner chorus (running inside this iframe's page) to
    // intercept link clicks so we can spawn new tiles instead of
    // navigating in place.
    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.postMessage({ type: 'chorus:parent:intercept-links' }, '*');
      } catch {}
    });

    inner.appendChild(el);
    return { path, col, el, hdr, iframe };
  }

  function addPage(path) {
    const existing = tiles.find((t) => t.path === path);
    if (existing) return existing;
    const t = makeTile(path, tiles.length);
    tiles.push(t);
    return t;
  }

  addPage(initialPath || 'index.html');

  // d3-zoom — pan on drag, wheel to zoom. The filter lets us restrict
  // drag-starts so clicking through into an iframe still works (d3 would
  // otherwise swallow pointerdowns as the start of a pan).
  const zoomBehavior = d3Zoom()
    .scaleExtent([0.1, 3])
    .filter((event) => {
      if (event.type === 'wheel') return true;
      const t = event.target;
      if (!t) return false;
      // Don't start a pan on the close/hint chrome, or inside an iframe.
      if (t === closeBtn || t === hint) return false;
      if (t.closest && (t.closest('iframe') || t.closest('.chorus-board-close'))) return false;
      // Allow everything else — background, tile headers, tile surface.
      return true;
    })
    .on('zoom', (event) => {
      const { x, y, k } = event.transform;
      inner.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
    });
  d3Select(container).call(zoomBehavior);

  // Click a tile header → fly to it. d3's drag-vs-click disambiguation
  // happens inside d3-zoom; a real click (no meaningful drag) fires
  // normally here.
  container.addEventListener('click', (e) => {
    const hdr = e.target?.closest?.('.chorus-board-tile-hdr');
    if (!hdr) return;
    const tile = tiles.find((t) => t.hdr === hdr);
    if (tile) flyToTile(tile);
  });

  function flyToTile(tile, padding = 0.9) {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = Math.min(
      (rect.width * padding) / TILE_W,
      (rect.height * padding) / TILE_H,
      2,
    );
    const cx = tile.col * (TILE_W + TILE_GAP) + TILE_W / 2;
    const cy = TILE_H / 2;
    const tx = rect.width / 2 - cx * scale;
    const ty = rect.height / 2 - cy * scale;
    d3Select(container).transition().duration(500).call(
      zoomBehavior.transform,
      zoomIdentity.translate(tx, ty).scale(scale),
    );
  }

  function flyToAll(padding = 0.92) {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const totalW = tiles.length * TILE_W + Math.max(0, tiles.length - 1) * TILE_GAP;
    const scale = Math.min(
      (rect.width * padding) / totalW,
      (rect.height * padding) / TILE_H,
      1,
    );
    const cx = totalW / 2;
    const cy = TILE_H / 2;
    const tx = rect.width / 2 - cx * scale;
    const ty = rect.height / 2 - cy * scale;
    d3Select(container).transition().duration(500).call(
      zoomBehavior.transform,
      zoomIdentity.translate(tx, ty).scale(scale),
    );
  }

  // Initial fit once layout has stabilised.
  setTimeout(() => flyToAll(), 60);

  // Link-click messages from the inner chorus. The normalizer strips the
  // rawcdn.githack /<owner>/<repo>/<sha>/ prefix off the URL so we end up
  // with a repo-relative path for previewUrlFor.
  const onMessage = (e) => {
    const d = e.data;
    if (!d || d.type !== 'chorus:preview:link') return;
    const source = tiles.find((t) => t.iframe?.contentWindow === e.source);
    if (!source) return;
    const path = normalizeLinkToRepoPath(d.href || '', source.path);
    if (!path) return;
    const tile = addPage(path);
    flyToTile(tile);
  };
  window.addEventListener('message', onMessage);

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    destroy();
    onClose?.();
  };
  document.addEventListener('keydown', onKey);

  // Reflow on window resize — container itself is sized via CSS vars so
  // it auto-resizes, but the fit calculation depends on its rect. A
  // cheap re-fit keeps the content nicely framed.
  const onResize = () => { flyToAll(); };
  window.addEventListener('resize', onResize);

  function destroy() {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    container.remove();
  }

  return { destroy, flyToTile, flyToAll, addPage };
}

function normalizeLinkToRepoPath(fullHref, fallback) {
  try {
    const u = new URL(fullHref);
    const m = u.pathname.match(/^\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
    if (!m) return fallback;
    let path = m[1];
    if (path.endsWith('/')) path += 'index.html';
    return path + u.search + u.hash;
  } catch {
    return fallback;
  }
}
