// Figma-style pannable / zoomable board of branch previews, rendered as
// real live iframes inside a Three.js CSS3DRenderer scene.
//
// Layout: a grid. Rows are branches (vertical stacking), columns are page
// paths (horizontal). The canvas starts with one column — whichever page
// chorus was already previewing — and grows horizontally as the user
// clicks links inside any preview. A link click doesn't navigate that
// iframe; it postMessages the target URL to the canvas, which adds a new
// column (one card per branch at that page) and flies to the clicked cell.
//
// Iframes are always interactive. Pan gestures work by dragging from the
// dark background between cards, or by drag-holding a card's title bar.
// Click-without-drag on a card's title bar flies to it.
//
// Three.js + CSS3DRenderer lazy-loaded from esm.sh on first open so the
// ~150 KB doesn't touch chorus's boot path.

let THREE = null;
let CSS3DRenderer = null;
let CSS3DObject = null;

async function ensureThree() {
  if (THREE) return;
  const [core, addon] = await Promise.all([
    import('https://esm.sh/three@0.163.0'),
    import('https://esm.sh/three@0.163.0/examples/jsm/renderers/CSS3DRenderer.js'),
  ]);
  THREE = core;
  CSS3DRenderer = addon.CSS3DRenderer;
  CSS3DObject = addon.CSS3DObject;
}

// Card geometry in world units. Aspect ~16:10.
//
// Branches stack on the Z axis (into the screen), not the Y axis —
// "vertical slices" in the 3D sense. Each branch deeper in the stack is
// offset slightly on Y too so it peeks out from behind the one in front
// (otherwise we'd just see the front branch and everything else would be
// fully occluded). Pages still spread horizontally on X.
const CARD_W = 1280;
const CARD_H = 800;
const COL_GAP = 360;
const BRANCH_Z_GAP = 520;   // each deeper branch is this far back
const BRANCH_Y_FAN = 90;    // and this far up, so it peeks out
const CAMERA_FOV = 50;
const CAMERA_Z_MIN = 400;
const CAMERA_Z_MAX = 40000;

export async function createCanvas({
  hostRoot,           // ShadowRoot to attach the overlay to
  branches,           // [{ name, ... }]
  previewUrlFor,      // (branchName, path) => url
  initialPath,        // string — the page path chorus was already showing
  onClose,            // () => void
}) {
  await ensureThree();

  const overlay = document.createElement('div');
  overlay.className = 'chorus-canvas';
  hostRoot.appendChild(overlay);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'chorus-canvas-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close canvas (Esc)';
  overlay.appendChild(closeBtn);
  closeBtn.addEventListener('click', () => { destroy(); onClose?.(); });

  const hint = document.createElement('div');
  hint.className = 'chorus-canvas-hint';
  hint.textContent = 'Drag background or header to pan · Wheel to zoom · Click a card header to fly to it · Click links inside to spawn new tiles';
  overlay.appendChild(hint);

  // Scene + camera + renderer ----------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    1,
    CAMERA_Z_MAX * 2,
  );
  camera.position.set(0, 0, 6000);

  const renderer = new CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const rendererEl = renderer.domElement;
  rendererEl.style.position = 'absolute';
  rendererEl.style.top = '0';
  rendererEl.style.left = '0';
  rendererEl.style.width = '100%';
  rendererEl.style.height = '100%';
  rendererEl.style.pointerEvents = 'auto';
  overlay.appendChild(rendererEl);

  // Grid state -----------------------------------------------------------
  // Rows (branches) are fixed at open time. Columns (page paths) grow as
  // the user clicks links. cards is a flat array; each card knows its
  // (row, col) indices.
  const rows = orderBranches(branches);
  const cols = [initialPath || 'index.html'];
  const cards = [];

  function cellPosition(row, col) {
    // Columns fan out horizontally, centered on x=0.
    const x = (col - (cols.length - 1) / 2) * (CARD_W + COL_GAP);
    // Branches stack in depth. Front branch (row 0) at z=0, each deeper
    // branch further back and a bit higher so it pokes out above the
    // front one.
    const z = -row * BRANCH_Z_GAP;
    const y = row * BRANCH_Y_FAN;
    return { x, y, z };
  }

  // Re-emit positions for every card. Called after cols grows so existing
  // cards recentre around the new total width.
  function layoutCards() {
    for (const c of cards) {
      const pos = cellPosition(c.row, c.col);
      c.obj.position.set(pos.x, pos.y, pos.z);
    }
  }

  function makeCard(branch, path, row, col) {
    const el = document.createElement('div');
    el.className = 'chorus-canvas-card';
    el.style.width = CARD_W + 'px';
    el.style.height = CARD_H + 'px';

    const hdr = document.createElement('div');
    hdr.className = 'chorus-canvas-card-hdr';
    const marker = document.createElement('span');
    marker.className = 'chorus-canvas-card-marker ' + markerClass(branch.name);
    hdr.appendChild(marker);
    const title = document.createElement('span');
    title.className = 'chorus-canvas-card-title';
    title.textContent = branch.name;
    hdr.appendChild(title);
    const subtitle = document.createElement('span');
    subtitle.className = 'chorus-canvas-card-subtitle';
    subtitle.textContent = path;
    hdr.appendChild(subtitle);
    el.appendChild(hdr);

    const iframe = document.createElement('iframe');
    iframe.src = previewUrlFor(branch.name, path);
    iframe.className = 'chorus-canvas-card-frame';
    el.appendChild(iframe);

    // Once the iframe is loaded, tell its inner chorus (via postMessage) to
    // intercept link clicks — relay them to us instead of navigating.
    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.postMessage({ type: 'chorus:parent:intercept-links' }, '*');
      } catch {}
    });

    const obj = new CSS3DObject(el);
    const pos = cellPosition(row, col);
    obj.position.set(pos.x, pos.y, pos.z);
    scene.add(obj);

    return { branch, path, row, col, el, hdr, iframe, obj };
  }

  // Initial fill: rows × cols at open
  rows.forEach((b, row) => {
    cols.forEach((p, col) => {
      cards.push(makeCard(b, p, row, col));
    });
  });

  // Add a new column for this page path. Idempotent: if path already has
  // a column, returns the existing col index without rebuilding.
  function addColumn(path) {
    const existing = cols.indexOf(path);
    if (existing >= 0) return existing;
    const newCol = cols.length;
    cols.push(path);
    // Existing cards need their X recomputed (the grid recentres as cols
    // grow). New cards get positioned by cellPosition naturally.
    rows.forEach((b, row) => {
      cards.push(makeCard(b, path, row, newCol));
    });
    layoutCards();
    return newCol;
  }

  function cardAt(row, col) {
    return cards.find((c) => c.row === row && c.col === col);
  }

  // Pan / click-to-fly handling ------------------------------------------
  // Drag anywhere on the canvas (including card headers) to pan. A
  // pointerup without meaningful movement on a header = fly to that card.
  // Clicks inside iframes never reach us — cross-origin isolation — so
  // those Just Work as normal page interactions.
  const MOVE_THRESHOLD = 4;
  let pointer = null;

  const onPointerDown = (e) => {
    pointer = {
      x: e.clientX, y: e.clientY,
      cx: camera.position.x, cy: camera.position.y,
      target: e.target,
      panning: false,
    };
    try { rendererEl.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    if (!pointer) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    if (!pointer.panning && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    pointer.panning = true;
    overlay.classList.add('panning');
    const fovRad = (camera.fov * Math.PI) / 180;
    const worldH = 2 * camera.position.z * Math.tan(fovRad / 2);
    const pxToWorld = worldH / window.innerHeight;
    camera.position.x = pointer.cx - dx * pxToWorld;
    camera.position.y = pointer.cy + dy * pxToWorld;
  };
  const onPointerUp = (e) => {
    if (!pointer) return;
    try { rendererEl.releasePointerCapture(e.pointerId); } catch {}
    overlay.classList.remove('panning');
    const wasClick = !pointer.panning;
    const target = pointer.target;
    pointer = null;
    if (!wasClick) return;
    const hdr = target?.closest?.('.chorus-canvas-card-hdr');
    if (!hdr) return;
    const card = cards.find((c) => c.hdr === hdr);
    if (card) flyToCard(card);
  };
  rendererEl.addEventListener('pointerdown', onPointerDown);
  rendererEl.addEventListener('pointermove', onPointerMove);
  rendererEl.addEventListener('pointerup', onPointerUp);
  rendererEl.addEventListener('pointercancel', onPointerUp);

  // Cursor-anchored wheel zoom — the point under the pointer stays put as
  // the camera dollies. When the pointer is over an iframe's interior,
  // this doesn't fire (iframe owns the wheel and scrolls its page), which
  // is the right call for "scroll the previewed page vs. zoom the canvas".
  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    const prevZ = camera.position.z;
    const newZ = clamp(prevZ * factor, CAMERA_Z_MIN, CAMERA_Z_MAX);
    if (newZ === prevZ) return;
    const rect = rendererEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const fovRad = (camera.fov * Math.PI) / 180;
    const worldHPrev = 2 * prevZ * Math.tan(fovRad / 2);
    const pxToWorldPrev = worldHPrev / rect.height;
    const worldPointX = camera.position.x + (cx - rect.width / 2) * pxToWorldPrev;
    const worldPointY = camera.position.y - (cy - rect.height / 2) * pxToWorldPrev;
    camera.position.z = newZ;
    const worldHNew = 2 * newZ * Math.tan(fovRad / 2);
    const pxToWorldNew = worldHNew / rect.height;
    const newWorldPointX = camera.position.x + (cx - rect.width / 2) * pxToWorldNew;
    const newWorldPointY = camera.position.y - (cy - rect.height / 2) * pxToWorldNew;
    camera.position.x += worldPointX - newWorldPointX;
    camera.position.y += worldPointY - newWorldPointY;
  };
  rendererEl.addEventListener('wheel', onWheel, { passive: false });

  // Camera tween ---------------------------------------------------------
  let anim = null;
  function startAnim(tx, ty, tz, duration = 700) {
    anim = {
      start: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: tx, y: ty, z: tz },
      duration,
      startTime: performance.now(),
    };
  }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function flyToCard(card, padding = 1.12) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const aspect = window.innerWidth / window.innerHeight;
    const zForH = (CARD_H * padding) / (2 * Math.tan(fovRad / 2));
    const zForW = (CARD_W * padding) / (2 * Math.tan(fovRad / 2) * aspect);
    const distance = Math.max(zForH, zForW);
    // Camera sits IN FRONT of the card's own Z plane (plus a bit of a
    // fan offset in Y so taller rows stay framed).
    startAnim(
      card.obj.position.x,
      card.obj.position.y,
      card.obj.position.z + distance,
      650,
    );
  }

  function flyToAll(padding = 1.25) {
    // Frame the whole grid from just in front of the front row (z=0).
    // The depth stack naturally shows behind as perspective distance.
    const totalW = cols.length * CARD_W + Math.max(0, cols.length - 1) * COL_GAP;
    // Vertical extent covers the card height plus all the Y fan offsets.
    const totalFanH = CARD_H + Math.max(0, rows.length - 1) * BRANCH_Y_FAN;
    // Centre of the Y fan — so all branches are vertically centred in view.
    const centerY = ((rows.length - 1) * BRANCH_Y_FAN) / 2;
    const fovRad = (camera.fov * Math.PI) / 180;
    const aspect = window.innerWidth / window.innerHeight;
    const zForH = (totalFanH * padding) / (2 * Math.tan(fovRad / 2));
    const zForW = (totalW * padding) / (2 * Math.tan(fovRad / 2) * aspect);
    const distance = Math.max(zForH, zForW, 2500);
    // Camera in front of the front row (z=0) by `distance`.
    startAnim(0, centerY, distance, 800);
  }

  // Link-click message handler. Inner chorus in any canvas iframe sends a
  // 'chorus:preview:link' with the absolute URL when a same-origin link
  // is clicked; we resolve that to a repo-relative path, add a column for
  // it (or reuse an existing one), and fly to the cell matching the
  // source card's branch.
  const onMessage = (e) => {
    const d = e.data;
    if (!d || d.type !== 'chorus:preview:link') return;
    const sourceCard = cards.find((c) => c.iframe?.contentWindow === e.source);
    if (!sourceCard) return;
    const path = normalizeLinkToRepoPath(d.href || '', sourceCard.path);
    if (!path) return;
    const col = addColumn(path);
    const card = cardAt(sourceCard.row, col);
    if (card) flyToCard(card);
  };
  window.addEventListener('message', onMessage);

  // RAF loop -------------------------------------------------------------
  let rafId = null;
  function tick() {
    if (anim) {
      const now = performance.now();
      const t = Math.min(1, (now - anim.startTime) / anim.duration);
      const e = easeInOutCubic(t);
      camera.position.x = anim.start.x + (anim.target.x - anim.start.x) * e;
      camera.position.y = anim.start.y + (anim.target.y - anim.start.y) * e;
      camera.position.z = anim.start.z + (anim.target.z - anim.start.z) * e;
      if (t >= 1) anim = null;
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }
  tick();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    destroy();
    onClose?.();
  };
  document.addEventListener('keydown', onKey);

  setTimeout(() => flyToAll(), 60);

  function destroy() {
    cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey);
    rendererEl.removeEventListener('pointerdown', onPointerDown);
    rendererEl.removeEventListener('pointermove', onPointerMove);
    rendererEl.removeEventListener('pointerup', onPointerUp);
    rendererEl.removeEventListener('pointercancel', onPointerUp);
    rendererEl.removeEventListener('wheel', onWheel);
    overlay.remove();
  }

  return { destroy, flyToCard, flyToAll, addColumn };
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Main/master first, then feature/, then auto/, then rest.
function orderBranches(branches) {
  const main = branches.find((b) => b.name === 'main' || b.name === 'master');
  const features = branches.filter((b) => b.name.startsWith('feature/'));
  const autos = branches.filter((b) => b.name.startsWith('auto/'));
  const handled = new Set([main, ...features, ...autos].filter(Boolean));
  const misc = branches.filter((b) => !handled.has(b));
  const out = [];
  if (main) out.push(main);
  out.push(...features, ...autos, ...misc);
  return out;
}

function markerClass(name) {
  if (name === 'main' || name === 'master') return 'main';
  if (name.startsWith('feature/')) return 'feature';
  if (name.startsWith('auto/')) return 'auto';
  return '';
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Convert a link click's full URL into a repo-relative path that the
// parent's previewUrlFor can consume. The iframe's location lives on
// rawcdn.githack and looks like:
//   https://rawcdn.githack.com/<owner>/<repo>/<sha>/<path>
// So we match the pathname and take the tail. For raw.githack (branch-
// based, not SHA-pinned) the shape is the same — /<owner>/<repo>/<ref>/<path>.
// Falls back to the current cell's path if we can't parse.
function normalizeLinkToRepoPath(fullHref, fallbackPath) {
  try {
    const u = new URL(fullHref);
    const m = u.pathname.match(/^\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
    if (!m) return fallbackPath;
    let path = m[1];
    if (path.endsWith('/')) path += 'index.html';
    return path + u.search + u.hash;
  } catch {
    return fallbackPath;
  }
}
