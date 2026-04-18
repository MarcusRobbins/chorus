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

const STYLE_FULL =
  'position:fixed; inset:0; width:100vw; height:100vh; border:0; ' +
  'background:white; z-index:2147483640;';

const STYLE_WINDOWED =
  'position:fixed; top:24px; left:24px; width:62vw; height:66vh; ' +
  'border:1px solid #bbb; border-radius:10px; ' +
  'box-shadow:0 20px 48px rgba(0,0,0,0.2); ' +
  'background:white; z-index:2147483640;';

export function show(url, opts = {}) {
  let iframe = document.getElementById(ID);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = ID;
    iframe.setAttribute('title', 'Branch preview');
    document.body.appendChild(iframe);
  }
  iframe.style.cssText = opts.windowed ? STYLE_WINDOWED : STYLE_FULL;
  if (iframe.src !== url) iframe.src = url;
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
