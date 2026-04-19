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

// Constant part of the style — set once on iframe creation. Properties that
// change between full and windowed mode are set individually on .style.*
// (not via cssText) so the browser sees them as transitions, not as a
// wholesale style replacement that it might coalesce with the previous set.
const STYLE_CONSTANT =
  'position:fixed; border:0; background:white; z-index:2147483640; ' +
  'transition: top .25s ease, left .25s ease, right .25s ease, bottom .25s ease, ' +
  'width .25s ease, height .25s ease, border-radius .25s ease, box-shadow .25s ease, border-color .25s ease;';

function applyMode(iframe, windowed) {
  const s = iframe.style;
  if (windowed) {
    // Height reads from a CSS variable on :root so the top-row resize
    // handle in chorus can drag the iframe + panel + phylogeny split
    // in unison. Default 66vh.
    // Width also reads from a variable so the vertical resize handle
    // between iframe and panel can adjust both at once. Default 62vw.
    s.top = '24px'; s.left = '24px'; s.right = 'auto'; s.bottom = 'auto';
    s.width = 'var(--chorus-iframe-width, 62vw)';
    s.height = 'var(--chorus-top-height, 66vh)';
    s.borderRadius = '10px';
    s.borderWidth = '1px'; s.borderStyle = 'solid'; s.borderColor = '#bbb';
    s.boxShadow = '0 20px 48px rgba(0,0,0,0.2)';
  } else {
    s.top = '0'; s.left = '0'; s.right = '0'; s.bottom = '0';
    s.width = '100vw'; s.height = '100vh';
    s.borderRadius = '0';
    s.borderWidth = '0'; s.borderStyle = 'none'; s.borderColor = 'transparent';
    s.boxShadow = 'none';
  }
  iframe.dataset.windowed = windowed ? '1' : '0';
}

export function show(url, opts = {}) {
  let iframe = document.getElementById(ID);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = ID;
    iframe.setAttribute('title', 'Branch preview');
    // Apply the constant styles on creation via cssText (atomic, no flash),
    // and the mode-specific styles via applyMode so a later setWindowed()
    // animates individual properties rather than replacing the whole style.
    iframe.style.cssText = STYLE_CONSTANT;
    applyMode(iframe, !!opts.windowed);
    document.body.appendChild(iframe);
  } else {
    applyMode(iframe, !!opts.windowed);
  }
  if (iframe.src !== url) iframe.src = url;
  emit();
}

// Resize an already-visible preview iframe between full and windowed modes
// WITHOUT reloading it. Used when the chorus panel opens/closes.
export function setWindowed(windowed) {
  const iframe = document.getElementById(ID);
  if (!iframe) return;
  if ((iframe.dataset.windowed === '1') === !!windowed) return; // no-op
  applyMode(iframe, !!windowed);
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
