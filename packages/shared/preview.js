// Shared branch-preview iframe. A singleton overlay; any UI surface on the
// page can call show/hide/reload, and all surfaces receive the same event so
// they can re-render their "is the preview visible?" state.

const ID = 'oss-kanban-preview-iframe';

export function show(url) {
  let iframe = document.getElementById(ID);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = ID;
    iframe.setAttribute('title', 'Branch preview');
    iframe.style.cssText =
      'position:fixed; inset:0; width:100vw; height:100vh; border:0; ' +
      'background:white; z-index:2147483640;';
    document.body.appendChild(iframe);
  }
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
