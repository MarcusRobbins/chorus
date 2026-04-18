// Shared branch-preview iframe. A singleton overlay; any UI surface on the
// page can call show/hide/reload, and all surfaces receive the same event so
// they can re-render their "is the preview visible?" state.
//
// Two rendering modes:
//   - default (full)  — iframe covers the whole viewport. Used by normal
//                       chorus embeds (OSSKanban) where the branch preview
//                       IS the experience.
//   - windowed         — smaller bordered iframe positioned top-left. Used
//                       by the chorus-on-chorus test-site so the outer and
//                       inner chorus don't fight for the same bottom-right.

const ID = 'oss-kanban-preview-iframe';

// Shared across both modes so the transition between them is smooth
// (width/height/inset animate; no flicker on the src reload).
const STYLE_BASE =
  'position:fixed; border:0; background:white; z-index:2147483640; ' +
  'transition: top .25s ease, left .25s ease, right .25s ease, bottom .25s ease, ' +
  'width .25s ease, height .25s ease, border-radius .25s ease, box-shadow .25s ease;';

const STYLE_FULL = STYLE_BASE +
  'top:0; left:0; right:0; bottom:0; width:100vw; height:100vh; ' +
  'border-radius:0; box-shadow:none;';

const STYLE_WINDOWED = STYLE_BASE +
  'top:24px; left:24px; right:auto; bottom:auto; width:62vw; height:66vh; ' +
  'border:1px solid #bbb; border-radius:10px; ' +
  'box-shadow:0 20px 48px rgba(0,0,0,0.2);';

export function show(url, opts = {}) {
  let iframe = document.getElementById(ID);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = ID;
    iframe.setAttribute('title', 'Branch preview');
    document.body.appendChild(iframe);
  }
  iframe.style.cssText = opts.windowed ? STYLE_WINDOWED : STYLE_FULL;
  iframe.dataset.windowed = opts.windowed ? '1' : '0';
  if (iframe.src !== url) iframe.src = url;
  emit();
}

// Resize an already-visible preview iframe between full and windowed modes
// WITHOUT reloading it. Used when the chorus panel opens/closes — the user
// wants the preview to shrink out of the way so both the page underneath
// and the panel are visible, without losing the iframe's current state.
export function setWindowed(windowed) {
  const iframe = document.getElementById(ID);
  if (!iframe) return;
  if ((iframe.dataset.windowed === '1') === !!windowed) return; // no-op
  iframe.style.cssText = windowed ? STYLE_WINDOWED : STYLE_FULL;
  iframe.dataset.windowed = windowed ? '1' : '0';
  emit();
}

export function reload() {
  const iframe = document.getElementById(ID);
  if (!iframe || !iframe.src) return;
  try {
    const url = new URL(iframe.src);
    url.searchParams.set('t', Date.now().toString(36));
    iframe.src = url.toString();
    emit();
  } catch { /* ignore */ }
}

export function hide() {
  document.getElementById(ID)?.remove();
  emit();
}

export function isShowing() {
  return !!document.getElementById(ID);
}

export function currentUrl() {
  return document.getElementById(ID)?.src || null;
}

function emit() {
  window.dispatchEvent(new CustomEvent('oss-kanban:preview:change'));
}
