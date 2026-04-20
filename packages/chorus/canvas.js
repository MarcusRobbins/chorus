// Figma-style pannable / zoomable board of branch previews, rendered as
// real live iframes inside a Three.js CSS3DRenderer scene. Cards lay out
// in a horizontal row at z=0; the camera dollies on Z to zoom, and pans
// on X/Y to move around. Click a card to smoothly fly the camera in and
// frame it. Esc or ✕ to close.
//
// Three.js (and the CSS3DRenderer addon) is fetched from esm.sh the first
// time the user opens this view — it's ~150 KB gzipped and chorus shouldn't
// pay for it at boot. The import is cached for the rest of the session.
//
// Architecture note: CSS3DRenderer does NOT use WebGL — it applies matrix3d
// CSS transforms to real DOM elements. That's why iframes in this scene are
// really alive (can receive events, show live-updating page content) — but
// we intentionally set pointer-events: none on the iframes so pan drags
// aren't swallowed by them. A sibling .card-click overlay is the hit
// target for the "click to zoom-to-card" gesture.

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

// Card geometry in world units. These are arbitrary; what matters is the
// aspect ratio (looks ~16:10-ish to mimic a desktop browser window) and
// the gap-to-card ratio (enough breathing room that cards don't look
// crowded when the whole row is visible).
const CARD_W = 1280;
const CARD_H = 800;
const CARD_GAP = 320;
const CAMERA_FOV = 50;
const CAMERA_Z_MIN = 400;
const CAMERA_Z_MAX = 20000;

// Public factory. Caller owns the returned { destroy } handle and must
// call destroy() when closing, which tears down the RAF loop + window
// listeners + removes the overlay from the shadow root.
export async function createCanvas({
  hostRoot,           // ShadowRoot to attach the overlay to
  branches,           // [{ name, ... }] — chorus's in-memory list
  previewUrlFor,      // (branchName) => url (from app.js)
  onClose,            // () => void — called when the user dismisses
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

  // Zoom-level hint at the bottom-left.
  const hint = document.createElement('div');
  hint.className = 'chorus-canvas-hint';
  hint.textContent = 'Drag to pan · Wheel to zoom · Click a card to fly to it';
  overlay.appendChild(hint);

  // Scene + camera + renderer ----------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    1,
    CAMERA_Z_MAX * 2,
  );
  camera.position.set(0, 0, 4000);

  const renderer = new CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const rendererEl = renderer.domElement;
  rendererEl.style.position = 'absolute';
  rendererEl.style.top = '0';
  rendererEl.style.left = '0';
  rendererEl.style.width = '100%';
  rendererEl.style.height = '100%';
  // The renderer's root receives our pointer events so pan/wheel work
  // anywhere on the canvas, not just the dark backdrop between cards.
  rendererEl.style.pointerEvents = 'auto';
  overlay.appendChild(rendererEl);

  // Build cards -----------------------------------------------------------
  const ordered = orderBranches(branches);
  const cards = ordered.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'chorus-canvas-card';
    el.style.width = CARD_W + 'px';
    el.style.height = CARD_H + 'px';

    const hdr = document.createElement('div');
    hdr.className = 'chorus-canvas-card-hdr';
    const marker = document.createElement('span');
    marker.className = 'chorus-canvas-card-marker ' + markerClass(b.name);
    hdr.appendChild(marker);
    const title = document.createElement('span');
    title.className = 'chorus-canvas-card-title';
    title.textContent = b.name;
    hdr.appendChild(title);
    el.appendChild(hdr);

    const iframe = document.createElement('iframe');
    iframe.src = previewUrlFor(b.name);
    iframe.className = 'chorus-canvas-card-frame';
    // pointer-events is set via CSS, NOT inline. That lets the .active
    // class on a card flip pointer-events: auto on its iframe (an inline
    // style would beat the CSS specificity and the toggle wouldn't work).
    el.appendChild(iframe);

    // Transparent hit overlay for the "click this card to fly to it"
    // gesture. Covers the iframe area but not the header (so future
    // header actions can be clickable).
    const click = document.createElement('div');
    click.className = 'chorus-canvas-card-click';
    click.dataset.branch = b.name;
    el.appendChild(click);

    const obj = new CSS3DObject(el);
    obj.position.x = (i - (ordered.length - 1) / 2) * (CARD_W + CARD_GAP);
    obj.position.y = 0;
    obj.position.z = 0;
    scene.add(obj);

    return { branch: b, el, obj, click };
  });

  // Which card (if any) is currently in interactive mode. While active:
  //   - its .card-click overlay is display:none so the iframe receives events
  //   - its .card iframe has pointer-events:auto (click/scroll/type into it)
  //   - a subtle accent ring highlights the card as "focused"
  // All managed via a .active class on the card element — CSS does the rest.
  let activeCard = null;
  function setActiveCard(next) {
    if (activeCard === next) return;
    if (activeCard) activeCard.el.classList.remove('active');
    activeCard = next;
    if (activeCard) activeCard.el.classList.add('active');
    updateHint();
  }
  function updateHint() {
    hint.textContent = activeCard
      ? 'Interacting with ' + activeCard.branch.name + ' · Esc or click outside to exit'
      : 'Drag to pan · Wheel to zoom · Click a card to fly in and interact';
  }
  updateHint();

  // Unified pointer handling: pan + click-to-fly disambiguated by how far
  // the pointer moved between down and up. Below MOVE_THRESHOLD px = click.
  const MOVE_THRESHOLD = 4;
  let pointer = null;       // { x, y, cx, cy, target, panning }
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
    // Convert screen-pixel delta to world-space delta at the camera's
    // current Z. With FOV, viewport_height_world = 2 · z · tan(fov/2).
    const fovRad = (camera.fov * Math.PI) / 180;
    const worldH = 2 * camera.position.z * Math.tan(fovRad / 2);
    const pxToWorld = worldH / window.innerHeight;
    camera.position.x = pointer.cx - dx * pxToWorld;
    camera.position.y = pointer.cy + dy * pxToWorld; // +Y up in Three space
  };
  const onPointerUp = (e) => {
    if (!pointer) return;
    try { rendererEl.releasePointerCapture(e.pointerId); } catch {}
    overlay.classList.remove('panning');
    const wasClick = !pointer.panning;
    const target = pointer.target;
    pointer = null;
    if (!wasClick) return;
    // Click on active card's own surface (e.g. its header) while active:
    // ignore. The iframe itself consumes events directly; this only fires
    // for non-iframe parts like the card header.
    if (activeCard && target?.closest?.('.chorus-canvas-card.active')) return;
    // Click on any card's hit overlay → fly + activate (swaps active if
    // another card was already active).
    const hit = target?.closest?.('.chorus-canvas-card-click');
    if (hit) {
      const card = cards.find((c) => c.click === hit);
      if (card) {
        flyToCard(card);
        setActiveCard(card);
      }
      return;
    }
    // Clicked empty background. If a card is active, deactivate it
    // (return to pan-and-pick mode). Otherwise do nothing.
    if (activeCard) setActiveCard(null);
  };
  rendererEl.addEventListener('pointerdown', onPointerDown);
  rendererEl.addEventListener('pointermove', onPointerMove);
  rendererEl.addEventListener('pointerup', onPointerUp);
  rendererEl.addEventListener('pointercancel', onPointerUp);

  // Wheel to zoom (camera dollies on Z). Preserves the world point under
  // the cursor by nudging camera X/Y proportionally — otherwise zoom-in
  // always pulls toward the origin, which feels broken.
  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    const prevZ = camera.position.z;
    const newZ = clamp(prevZ * factor, CAMERA_Z_MIN, CAMERA_Z_MAX);
    if (newZ === prevZ) return;
    // Point under cursor in world coords at prev zoom
    const rect = rendererEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const fovRad = (camera.fov * Math.PI) / 180;
    const worldHPrev = 2 * prevZ * Math.tan(fovRad / 2);
    const pxToWorldPrev = worldHPrev / rect.height;
    const worldPointX = camera.position.x + (cx - rect.width / 2) * pxToWorldPrev;
    const worldPointY = camera.position.y - (cy - rect.height / 2) * pxToWorldPrev;
    camera.position.z = newZ;
    // At the new zoom, recompute the world point under the cursor and
    // shift camera so it lands on the same world coord.
    const worldHNew = 2 * newZ * Math.tan(fovRad / 2);
    const pxToWorldNew = worldHNew / rect.height;
    const newWorldPointX = camera.position.x + (cx - rect.width / 2) * pxToWorldNew;
    const newWorldPointY = camera.position.y - (cy - rect.height / 2) * pxToWorldNew;
    camera.position.x += worldPointX - newWorldPointX;
    camera.position.y += worldPointY - newWorldPointY;
  };
  rendererEl.addEventListener('wheel', onWheel, { passive: false });

  // Camera animation -----------------------------------------------------
  // Simple property tween on camera.position over duration ms. Only one
  // animation at a time; a new flyTo clobbers the previous.
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
    // Z needed so the card fits in the viewport at FOV — pick the tighter
    // of "height fits" and "width fits" constraints.
    const zForH = (CARD_H * padding) / (2 * Math.tan(fovRad / 2));
    const zForW = (CARD_W * padding) / (2 * Math.tan(fovRad / 2) * aspect);
    startAnim(card.obj.position.x, card.obj.position.y, Math.max(zForH, zForW), 650);
  }

  function flyToAll(padding = 1.12) {
    const totalW = ordered.length * CARD_W + Math.max(0, ordered.length - 1) * CARD_GAP;
    const fovRad = (camera.fov * Math.PI) / 180;
    const aspect = window.innerWidth / window.innerHeight;
    const zForH = (CARD_H * padding) / (2 * Math.tan(fovRad / 2));
    const zForW = (totalW * padding) / (2 * Math.tan(fovRad / 2) * aspect);
    startAnim(0, 0, Math.max(zForH, zForW, 2500), 800);
  }

  // RAF loop --------------------------------------------------------------
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

  // Resize, escape, fit-all-on-open --------------------------------------
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // Esc exits active mode first (so the user can get out of an iframe
    // without closing the whole canvas). Only when already in pan mode
    // does Esc close the canvas.
    if (activeCard) { setActiveCard(null); return; }
    destroy();
    onClose?.();
  };
  document.addEventListener('keydown', onKey);

  // Give iframes a beat to start loading before the fit animation kicks in.
  setTimeout(() => flyToAll(), 60);

  function destroy() {
    cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    rendererEl.removeEventListener('pointerdown', onPointerDown);
    rendererEl.removeEventListener('pointermove', onPointerMove);
    rendererEl.removeEventListener('pointerup', onPointerUp);
    rendererEl.removeEventListener('pointercancel', onPointerUp);
    rendererEl.removeEventListener('wheel', onWheel);
    overlay.remove();
  }

  return { destroy, flyToCard, flyToAll };
}

// Order: main first, then feature/, then auto/, then the rest. Matches the
// ordering the list view uses.
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
