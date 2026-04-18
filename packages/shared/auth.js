// Shared auth state — widget pushes, switcher (and anyone else) reads.
// Token is in memory only, same as the widget's own storage.
// Changes fire a `oss-kanban:auth:change` event on window.

const state = { token: null, user: null };

export function setAuth(token, user) {
  state.token = token || null;
  state.user = user || null;
  window.dispatchEvent(new CustomEvent('oss-kanban:auth:change'));
}

export function clearAuth() {
  setAuth(null, null);
}

export function getToken() { return state.token; }
export function getUser() { return state.user; }
export function isAuthed() { return !!state.token; }
