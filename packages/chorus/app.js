// Chorus — unified panel that replaces the previous widget+switcher duo.
//
// One panel, one entry point, clear navigation between screens:
//   Browse → Propose / Feature → AI session → back
//
// Drop-in embed:
//   <script type="module"
//     id="chorus"
//     src="https://…/packages/chorus/app.js"
//     data-github-client-id="..."
//     data-github-repo="owner/name"
//     data-github-auth-proxy="https://…"
//     data-openai-model="gpt-4o"
//     data-debug="true"></script>

import * as gh from '../widget/gh-client.js';
import { runSession as runAiSession } from '../widget/ai-client.js';
import * as preview from '../shared/preview.js';
import * as auth from '../shared/auth.js';

// ───────────────────────────────────────────────────────────────────
// Styles — defined up front so the boot path can use them without TDZ
// ───────────────────────────────────────────────────────────────────
const CSS_TEXT = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }

  /* Trigger pill (collapsed) */
  .trigger {
    position: fixed; bottom: 20px; right: 20px;
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 14px; border-radius: 20px;
    background: #111; color: #fff; border: none;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    font-size: 13px; cursor: pointer; pointer-events: auto;
    transition: transform .15s ease, background .15s ease;
    max-width: 340px;
  }
  .trigger:hover { background: #222; transform: translateY(-1px); }
  .trigger .dot {
    width: 8px; height: 8px; border-radius: 4px; background: #666; flex-shrink: 0;
  }
  .trigger .dot.authed { background: #4a4; }
  .trigger .dot.working { background: #fa4; animation: pulse 1.2s ease-in-out infinite; }
  .trigger .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }

  /* Panel shell */
  .panel {
    position: fixed; bottom: 20px; right: 20px;
    width: 420px; max-height: 82vh;
    background: #fff; color: #111;
    border-radius: 12px; border: 1px solid #e2e2e2;
    box-shadow: 0 20px 48px rgba(0,0,0,0.18);
    display: flex; flex-direction: column;
    pointer-events: auto;
    overflow: hidden;
  }

  /* Header */
  .header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #eee;
    background: #fafafa;
  }
  .header .back {
    border: none; background: transparent; cursor: pointer;
    font-size: 16px; color: #666; padding: 2px 6px; border-radius: 4px;
  }
  .header .back:hover { background: #eee; color: #111; }
  .header .back[hidden] { display: none; }
  .header .title {
    flex: 1; font-size: 13px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .header .title code {
    font-family: ui-monospace, monospace; font-size: 12px; font-weight: 400;
    color: #555; background: #f0f0f0; padding: 1px 6px; border-radius: 4px;
  }
  .header .close {
    border: none; background: transparent; cursor: pointer;
    font-size: 16px; color: #888; padding: 2px 6px; border-radius: 4px;
  }
  .header .close:hover { background: #eee; color: #111; }

  /* Body (scrollable) */
  .body {
    flex: 1; overflow: auto;
    padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
    font-size: 13px;
  }
  .body p { margin: 0; color: #333; line-height: 1.45; }
  .body .muted { color: #666; font-size: 12px; }
  .body .muted-s { color: #888; font-size: 11px; }
  .body .err { padding: 8px 10px; background: #fff0f0; border: 1px solid #f0c0c0; color: #a00; border-radius: 6px; font-size: 12px; }
  .body .ok { padding: 8px 10px; background: #f0fff3; border: 1px solid #c0e0c0; color: #060; border-radius: 6px; font-size: 12px; }
  .body code {
    font-family: ui-monospace, monospace; font-size: 12px;
    background: #f0f0f0; padding: 1px 5px; border-radius: 3px;
  }

  /* Action bar */
  .action-bar {
    padding: 10px 12px;
    border-top: 1px solid #eee;
    background: #fafafa;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .action-bar .secondary { display: flex; gap: 10px; }
  .action-bar .secondary button {
    background: transparent; border: none; color: #0366d6;
    font-size: 12px; cursor: pointer; padding: 4px;
  }
  .action-bar .secondary button:hover { text-decoration: underline; }
  .action-bar .primary {
    font: inherit; font-size: 13px; font-weight: 500;
    padding: 8px 16px; border-radius: 6px; cursor: pointer;
    background: #f00; color: #fff; border: 1px solid #f00;
  }
  .action-bar .primary:disabled { background: #aaa; border-color: #aaa; cursor: default; }
  .action-bar .primary.green { background: #2a6; border-color: #2a6; }
  .action-bar .primary:hover:not(:disabled) { background: #b00; }

  /* Form controls */
  label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #444; }
  label.field input, label.field textarea {
    font: inherit; font-size: 13px; padding: 7px 9px;
    border: 1px solid #ccc; border-radius: 6px; color: #111;
    background: #fff;
  }
  label.field input:focus, label.field textarea:focus {
    outline: 2px solid #0366d6; outline-offset: -1px; border-color: #0366d6;
  }
  label.field textarea { min-height: 64px; resize: vertical; }
  input[type="password"].key-input {
    font-family: ui-monospace, monospace; font-size: 12px;
  }

  /* Branch list */
  .branch-list { display: flex; flex-direction: column; gap: 1px; }
  .branch {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 6px; cursor: pointer;
    transition: background .08s ease;
  }
  .branch:hover { background: #f5f5f5; }
  .branch.active { background: #eaf4ff; }
  .branch .name { flex: 1; font-family: ui-monospace, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .branch .sha { font-family: ui-monospace, monospace; font-size: 11px; color: #999; }
  .branch .marker {
    font-size: 10px; padding: 1px 6px; border-radius: 6px;
    text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;
  }
  .branch .marker.main { background: #222; color: #fff; }
  .branch .marker.feature { background: #e6f4ff; color: #0366d6; }
  .branch .marker.auto { background: #fff4e6; color: #a60; }
  .section-heading { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin: 6px 0 2px; }

  /* Capture card */
  .capture {
    padding: 8px; border-radius: 6px;
    font-family: ui-monospace, monospace; font-size: 11px;
    background: #f4f4f4; color: #444; word-break: break-all;
    max-height: 70px; overflow: auto;
  }
  .capture.empty { color: #999; font-style: italic; font-family: inherit; }

  /* AI log */
  .log {
    font-family: ui-monospace, monospace; font-size: 11px;
    padding: 8px; background: #fafafa; border: 1px solid #eee; border-radius: 6px;
    max-height: 200px; overflow: auto;
    display: flex; flex-direction: column; gap: 2px;
  }
  .log-line { white-space: pre-wrap; word-break: break-word; }
  .log-line.muted { color: #888; }

  /* Device-flow code */
  .device-code {
    font-family: ui-monospace, monospace; font-size: 22px; font-weight: 600;
    padding: 14px; background: #111; color: #fff; border-radius: 8px;
    text-align: center; letter-spacing: 3px; user-select: all;
  }

  /* Who strip */
  .who { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #555; }
  .who img { width: 18px; height: 18px; border-radius: 9px; }

  /* Issue block */
  .issue {
    border: 1px solid #eee; border-radius: 8px; padding: 10px;
    background: #fcfcfc;
    display: flex; flex-direction: column; gap: 6px;
  }
  .issue-hdr { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .issue-hdr .n { color: #888; font-family: ui-monospace, monospace; font-size: 11px; }
  .issue-hdr .t { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .issue-hdr .st {
    font-size: 10px; padding: 2px 6px; border-radius: 6px;
    text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
  }
  .issue-hdr .st.open { background: #e6ffe6; color: #060; }
  .issue-hdr .st.closed { background: #eee; color: #555; }
  .issue-body {
    padding: 6px 8px; border-radius: 4px;
    background: #fff; border: 1px solid #f0f0f0;
    font-size: 11px; color: #333;
    max-height: 80px; overflow: auto;
    white-space: pre-wrap; word-break: break-word;
  }
  .issue-actions { display: flex; gap: 8px; align-items: center; font-size: 11px; }
  .vote {
    display: inline-flex; align-items: center; gap: 4px;
    background: #fff; border: 1px solid #ddd; border-radius: 14px;
    padding: 2px 10px; cursor: pointer; font-size: 12px;
  }
  .vote:hover:not(:disabled) { background: #f4f4f4; }
  .vote:disabled { opacity: 0.5; cursor: default; }
  .comments-btn {
    background: transparent; border: none; color: #0366d6; font-size: 11px; cursor: pointer; padding: 2px 4px;
  }
  .comments {
    margin-top: 4px; border-top: 1px solid #f0f0f0; padding-top: 6px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .comment {
    padding: 6px 8px; border-radius: 4px; background: #fff; border: 1px solid #f0f0f0;
    font-size: 11px;
  }
  .comment-hdr { font-size: 10px; color: #666; display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
  .comment-hdr img { width: 14px; height: 14px; border-radius: 7px; }
  .comment-body { color: #222; white-space: pre-wrap; word-break: break-word; }
  .compose textarea { min-height: 40px; font-size: 12px; }
  .compose-actions { display: flex; justify-content: flex-end; gap: 6px; }

  /* Overlay + hint (element picker on host page) */
  .overlay {
    position: fixed; pointer-events: none;
    border: 2px solid #c33; background: rgba(204,51,51,0.08);
    z-index: 2147483645; transition: all .05s linear;
  }
  .hint {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: #111; color: #fff; padding: 6px 12px; border-radius: 6px;
    font-size: 12px; pointer-events: none;
  }

  /* Feature banner */
  .feature-banner {
    padding: 8px 10px; border-radius: 6px; font-size: 12px;
    background: #fff8e1; border: 1px solid #ffd77a;
    display: flex; flex-direction: column; gap: 4px;
  }
  .feature-banner.ok { background: #f0fff3; border-color: #c0e0c0; }
  .feature-banner.err { background: #fff0f0; border-color: #f0c0c0; color: #a00; }
`;

// ───────────────────────────────────────────────────────────────────
// Entry: dispatch between preview-mode (in iframe) vs full app (top-level)
// ───────────────────────────────────────────────────────────────────
if (window.__chorusLoaded) {
  // already loaded in this window
} else {
  window.__chorusLoaded = true;
  try {
    const inIframe = window !== window.top;
    // Opt-in override: some embeds want the FULL chorus UI inside an iframe
    // (e.g. the chorus-on-chorus test-site wants to visually demonstrate UI
    // changes to the tool itself, which silent preview mode would hide).
    const scriptEl =
      document.getElementById('chorus') ||
      document.querySelector('script[data-preview-mode]') ||
      document.querySelector('script[data-github-client-id]');
    const forceFull = scriptEl?.dataset?.previewMode === 'full';
    if (inIframe && !forceFull) {
      bootPreviewMode();
    } else {
      // When running FULL inside an iframe (chorus-on-chorus), we still need
      // the preview-mode picker + location reporter so the outer chorus can
      // pick elements and track navigation in here. bootPreviewMode is inert
      // until the parent requests picking, so it coexists with full boot.
      if (inIframe && forceFull) bootPreviewMode();
      boot({ inIframe });
    }
  } catch (err) {
    console.error('[chorus] boot failed:', err);
  }
}

// ───────────────────────────────────────────────────────────────────
// Preview mode — runs inside preview iframes. Only element picking +
// location reporting via postMessage to the parent window.
// Same logic as the previous widget's preview mode.
// ───────────────────────────────────────────────────────────────────
function bootPreviewMode() {
  console.log('[chorus] bootPreviewMode ENTER', {
    href: location.href,
    hasParent: window.parent !== window,
  });
  const postLocation = () => {
    try {
      window.parent.postMessage({
        type: 'chorus:preview:location',
        href: location.href,
        path: (location.pathname || '') + (location.search || '') + (location.hash || ''),
      }, '*');
    } catch {}
  };
  postLocation();
  window.addEventListener('hashchange', postLocation);
  window.addEventListener('popstate', postLocation);

  let picking = false, overlay = null, hint = null;

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    console.log('[chorus/preview-mode] message from parent', d.type);
    if (d.type === 'chorus:parent:start-pick') startPick();
    if (d.type === 'chorus:parent:cancel-pick') cancelPick();
  });

  function startPick() {
    if (picking) return;
    picking = true;
    // z-index must beat the inner chorus's own shadow-host (2147483646) so
    // the picker overlay + hint render on TOP of the inner popover rather
    // than being hidden behind it. Without this the red highlight is
    // invisible when hovering inside the popover.
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed; pointer-events:none; border:2px solid #c33; ' +
      'background:rgba(204,51,51,0.08); z-index:2147483647; ' +
      'transition:all .05s linear; display:none;';
    document.body.appendChild(overlay);
    hint = document.createElement('div');
    hint.style.cssText =
      'position:fixed; top:16px; left:50%; transform:translateX(-50%); ' +
      'background:#111; color:#fff; padding:6px 12px; border-radius:6px; ' +
      'font-size:12px; pointer-events:none; z-index:2147483647; ' +
      'font-family:system-ui,sans-serif;';
    hint.textContent = 'Click any element · Esc to cancel';
    document.body.appendChild(hint);
    document.addEventListener('mousemove', onHover, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }
  function cancelPick(notify = true) {
    if (!picking) return;
    picking = false;
    overlay?.remove(); overlay = null;
    hint?.remove(); hint = null;
    document.removeEventListener('mousemove', onHover, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (notify) {
      try { window.parent.postMessage({ type: 'chorus:preview:cancelled' }, '*'); } catch {}
    }
  }
  // composedPath() returns the real event target even across shadow roots.
  // Without it, events inside a closed/open shadow tree retarget to the host
  // element — so the picker can't see elements inside e.g. the inner chorus's
  // shadow-root UI.
  function realTarget(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path[0] instanceof Element ? path[0] : e.target;
  }
  let lastHoverLog = 0;
  function onHover(e) {
    const target = realTarget(e);
    if (!(target instanceof Element)) return;
    // Log sparingly — once every 500ms — so we can see what the picker is
    // actually resolving without flooding the console.
    const now = Date.now();
    if (now - lastHoverLog > 500) {
      lastHoverLog = now;
      const path = e.composedPath?.() ?? [];
      console.log('[chorus/preview-mode] hover', {
        evTarget: (e.target && e.target.tagName) + (e.target?.id ? '#' + e.target.id : ''),
        path0: (path[0] && path[0].tagName) + (path[0]?.id ? '#' + path[0].id : ''),
        pathLen: path.length,
        resolved: target.tagName + (target.id ? '#' + target.id : ''),
      });
    }
    const r = target.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }
  function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    const el = realTarget(e);
    if (!(el instanceof Element)) return;
    const r = el.getBoundingClientRect();
    const capture = {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      text: (el.innerText || '').trim().slice(0, 200),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      url: location.href,
    };
    try { window.parent.postMessage({ type: 'chorus:preview:capture', capture }, '*'); } catch {}
    cancelPick(false);
  }
  function onKey(e) { if (e.key === 'Escape') cancelPick(); }
}

function cssPath(el) {
  if (!(el instanceof Element)) return '';
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = [];
  let cur = el;
  // Walk up through normal DOM *and* through shadow boundaries. When we hit
  // the top of a shadow tree (parentElement is null but parentNode is a
  // ShadowRoot), hop to the shadow host and continue. We insert a `::shadow`
  // marker so the consumer (and the AI) can tell the element is inside a
  // shadow root — useful context when the target is part of a web-component
  // or a widget that uses shadow DOM for style isolation (like chorus itself).
  while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
    let seg = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(seg);
    if (parent && parent.id) { parts.unshift('#' + CSS.escape(parent.id)); break; }
    if (parent) { cur = parent; continue; }
    // No parentElement — might be at the root of a shadow tree. Cross over.
    const root = cur.getRootNode?.();
    if (root && root.host instanceof Element) {
      parts.unshift('::shadow');
      cur = root.host;
      continue;
    }
    break;
  }
  return parts.join(' > ');
}

// ───────────────────────────────────────────────────────────────────
// Full app boot
// ───────────────────────────────────────────────────────────────────
function boot({ inIframe = false } = {}) {
  const script =
    document.getElementById('chorus') ||
    document.getElementById('oss-kanban-widget') ||
    document.querySelector('script[data-github-client-id]');

  const CLIENT_ID = script?.dataset?.githubClientId || '';
  const REPO = script?.dataset?.githubRepo || '';
  const AUTH_PROXY = script?.dataset?.githubAuthProxy || '';
  const DEFAULT_MODEL = script?.dataset?.openaiModel || 'gpt-4o';
  const DEBUG = script?.dataset?.debug === 'true';
  // Boot-entry trace so we can tell from the console whether it's the outer
  // (top-level) or inner (iframe) chorus that's reloading repeatedly.
  if (DEBUG) {
    console.log('[chorus] boot ENTER', {
      inIframe,
      origin: location.origin,
      href: location.href,
      scriptSrc: script?.src,
    });
  }
  // data-auto-preview: open a preview iframe of the current branch on boot,
  // so the user always sees both the outer (stable) and inner (branch
  // version) chorus instances side-by-side. Intended for the chorus-on-
  // chorus test-site; regular embeds leave this off.
  const AUTO_PREVIEW = script?.dataset?.autoPreview === 'true';
  const SCOPES = 'public_repo workflow';

  const [OWNER, REPONAME] = REPO.split('/');
  const log = (...a) => { if (DEBUG) console.log('[chorus]', ...a); };

  const DEVICE_CODE_URL = AUTH_PROXY ? `${AUTH_PROXY}/device/code` : 'https://github.com/login/device/code';
  const OAUTH_TOKEN_URL = AUTH_PROXY ? `${AUTH_PROXY}/oauth/token` : 'https://github.com/login/oauth/access_token';

  // ── sessionStorage persistence ─────────────────────────────────
  const STORAGE_PREFIX = `chorus.${REPO || 'default'}.`;
  const storeSave = (k, v) => { try { sessionStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v)); } catch {} };
  const storeLoad = (k) => { try { const r = sessionStorage.getItem(STORAGE_PREFIX + k); return r == null ? null : JSON.parse(r); } catch { return null; } };
  const storeClear = (k) => { try { sessionStorage.removeItem(STORAGE_PREFIX + k); } catch {} };

  const savedToken = storeLoad('token');
  const savedUser = storeLoad('user');
  const savedOpenAIKey = storeLoad('openaiKey');

  // ── State ──────────────────────────────────────────────────────
  const state = {
    open: false,

    // Navigation
    screen: 'browse',       // browse | propose | feature | ai | signIn | devicePending | keyPrompt | settings
    backStack: [],          // array of { screen, ctx }
    pendingIntent: null,    // { afterSignIn: 'navigateToX' } for interstitials

    // Auth
    token: savedToken,
    user: savedUser,
    auth: savedToken ? 'authed' : 'idle',
    authError: null,
    deviceFlow: null,

    // OpenAI
    openaiKey: savedOpenAIKey,

    // Context
    currentBranch: 'main',
    currentPath: initialSitePath(),

    // Browse
    branches: [],
    branchesLoading: false,
    branchesError: null,

    // Propose
    name: '',
    description: '',
    capture: null,
    filing: false,

    // Feature detail
    featureBranch: null,
    featureIssues: [],
    featureLoading: false,
    featureError: null,
    featureComments: new Map(),      // issue.number → comments[]
    featureExpanded: new Set(),
    featureComposeDraft: new Map(),
    featureMergeStatus: null,        // null | 'pending' | { ok, sha } | { error }

    // AI session
    ai: null,                        // { issueNumber, branch, workingRef, previewUrl, messages, turn, events, staged, summary, status, error, followUpDraft }

    // Picker
    pickMode: false,
  };

  if (savedToken && savedUser) auth.setAuth(savedToken, savedUser);

  // ── DOM: host + shadow + trigger ──────────────────────────────
  const host = document.createElement('div');
  host.id = 'chorus-host';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
  document.body.appendChild(host);
  // mode: 'open' — the outer picker (running inside a preview iframe for
  // chorus-on-chorus) relies on composedPath() piercing the shadow boundary
  // so it can highlight and select elements INSIDE the chorus UI itself.
  // Closed shadow roots truncate composedPath at the host from outside, which
  // made the picker stop at #chorus-host. Chorus doesn't store any secrets
  // in the shadow tree, so opening it up has no real cost.
  const root = host.attachShadow({ mode: 'open' });
  if (DEBUG) console.log('[chorus] shadow attached', { mode: host.shadowRoot ? 'open' : 'closed' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS_TEXT;
  root.appendChild(styleEl);

  // When this chorus is acting as a meta-editor (auto-preview enabled on the
  // top-level page), preview iframes open in a "windowed" mode — a bordered,
  // smaller-than-viewport frame — so the inner chorus inside it lives at its
  // own bottom-right without colliding with this (outer) chorus's bottom-
  // right. The visual container IS the cue; no position or colour overrides
  // needed on the pill itself.
  const IS_META = !inIframe && AUTO_PREVIEW;

  // All preview-iframe opens route through this helper so the meta-editor
  // case (chorus-on-chorus) opens the iframe in "windowed" mode. Other
  // chorus embeds leave it at full-viewport.
  function showPreviewFrame(url) {
    if (DEBUG) {
      // Trace who called us so we can diagnose runaway loops.
      console.log('[chorus] showPreviewFrame →', url);
      console.trace('[chorus] caller');
    }
    preview.show(url, { windowed: IS_META });
  }

  // ── SHA-pinned preview URLs ────────────────────────────────────
  // raw.githack.com with a branch name caches for ~10 minutes on its edge,
  // which makes fast-iteration chorus-on-chorus miserable. rawcdn.githack.com
  // with a commit SHA is immutable and never stale. We resolve the branch's
  // tip SHA via the GitHub API, cache it, and build the URL against rawcdn.
  const branchShaCache = new Map(); // branchName → { sha, fetchedAt }
  const BRANCH_SHA_TTL_MS = 15 * 1000; // re-resolve if older than 15s

  async function resolveBranchSha(branchName) {
    const cached = branchShaCache.get(branchName);
    if (cached && Date.now() - cached.fetchedAt < BRANCH_SHA_TTL_MS) {
      return cached.sha;
    }
    try {
      const token = auth.getToken();
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPONAME}/branches/${encodeURIComponent(branchName)}`,
        { headers: {
            'Accept': 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          } }
      );
      if (!res.ok) throw new Error('branch-sha ' + res.status);
      const data = await res.json();
      const sha = data?.commit?.sha;
      if (!sha) throw new Error('branch-sha: no commit sha in response');
      branchShaCache.set(branchName, { sha, fetchedAt: Date.now() });
      return sha;
    } catch (err) {
      if (DEBUG) console.log('[chorus] resolveBranchSha failed', branchName, err);
      return null;
    }
  }

  function buildPreviewUrl({ branch, sha, path = state.currentPath }) {
    let cleanPath = String(path || 'index.html').replace(/^\/+/g, '');
    cleanPath = cleanPath.replace(new RegExp(`^${OWNER}/${REPONAME}/[^?#]+?/`), '');
    const qIdx = cleanPath.indexOf('?');
    const pathPart = qIdx >= 0 ? cleanPath.slice(0, qIdx) : cleanPath;
    const queryPart = qIdx >= 0 ? cleanPath.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(queryPart);
    sp.delete('t');
    const rebuiltQuery = sp.toString();
    // SHA-pinned → rawcdn (immutable, never stale). Fallback to branch URL on
    // raw.githack if SHA resolution failed — worse caching but still works.
    if (sha) {
      return `https://rawcdn.githack.com/${OWNER}/${REPONAME}/${sha}/${pathPart}${rebuiltQuery ? '?' + rebuiltQuery : ''}`;
    }
    const sep = rebuiltQuery ? '&' : '?';
    return `https://raw.githack.com/${OWNER}/${REPONAME}/${encodeURIComponent(branch)}/${pathPart}${rebuiltQuery ? '?' + rebuiltQuery : ''}${sep}t=${Date.now().toString(36)}`;
  }

  // Async "show preview for this branch, freshest content". Resolves the
  // tip SHA first so we dodge raw.githack's edge cache entirely.
  async function showBranchPreview(branchName, path = state.currentPath) {
    const sha = await resolveBranchSha(branchName);
    const url = buildPreviewUrl({ branch: branchName, sha, path });
    if (DEBUG) console.log('[chorus] showBranchPreview', { branchName, sha: sha?.slice(0, 7), url });
    showPreviewFrame(url);
    return url;
  }

  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.addEventListener('click', () => {
    state.open ? closePanel() : openPanel();
  });
  root.appendChild(trigger);

  renderTrigger();

  // ── Panel open/close ──────────────────────────────────────────
  let panelEl = null;

  function openPanel() {
    state.open = true;
    trigger.style.display = 'none';
    renderPanel();
  }
  function closePanel() {
    state.open = false;
    panelEl?.remove(); panelEl = null;
    trigger.style.display = '';
    renderTrigger();
  }

  // ── Navigation ────────────────────────────────────────────────
  function navigate(screen, opts = {}) {
    if (opts.push !== false) {
      state.backStack.push({ screen: state.screen });
    }
    state.screen = screen;
    if (opts.reset) state.backStack = [];
    renderPanel();
  }
  function goBack() {
    const prev = state.backStack.pop();
    if (prev) { state.screen = prev.screen; }
    else state.screen = 'browse';
    renderPanel();
  }

  // Gate — redirect to sign-in if not authed, store pending intent
  function requireAuth(intendedScreen) {
    if (state.auth === 'authed' && state.token) return true;
    state.pendingIntent = intendedScreen;
    navigate('signIn');
    return false;
  }

  // ── Trigger rendering ─────────────────────────────────────────
  function renderTrigger() {
    let dotClass = '';
    let label = 'Chorus';
    if (state.ai?.status === 'running' || state.ai?.status === 'committing' || state.filing) {
      dotClass = 'working';
      label = 'Chorus · working…';
    } else if (state.auth === 'authed') {
      dotClass = 'authed';
      label = `Chorus · ${REPO || 'not configured'}`;
    }
    trigger.innerHTML = `
      <span class="dot ${dotClass}"></span>
      <span class="label">${esc(label)}</span>
    `;
  }

  // ── Panel rendering ───────────────────────────────────────────
  function renderPanel() {
    if (!state.open) { renderTrigger(); return; }
    panelEl?.remove();
    panelEl = document.createElement('div');
    panelEl.className = 'panel';

    const header = renderHeader();
    const body = renderBody();
    const actionBar = renderActionBar();

    panelEl.appendChild(header);
    panelEl.appendChild(body);
    if (actionBar) panelEl.appendChild(actionBar);
    root.appendChild(panelEl);

    wirePanel();
    renderTrigger();
  }

  // Header
  function renderHeader() {
    const title = headerTitle();
    const canBack = state.backStack.length > 0;
    const el = document.createElement('div');
    el.className = 'header';
    el.innerHTML = `
      <button class="back" ${canBack ? '' : 'hidden'} data-action="back" title="Back">←</button>
      <div class="title">${title}</div>
      <button class="close" data-action="close" title="Close">✕</button>
    `;
    return el;
  }
  function headerTitle() {
    if (!configOK()) return 'Chorus';
    switch (state.screen) {
      case 'browse':        return `${esc(REPO)}`;
      case 'propose':       return 'Suggest a change';
      case 'feature':       return `<code>${esc(state.featureBranch || '…')}</code>`;
      case 'ai':            return state.ai?.status === 'running'
                              ? `AI working on <code>${esc(state.ai.branch || '…')}</code>`
                              : `<code>${esc(state.ai?.branch || '…')}</code>`;
      case 'signIn':        return 'Sign in with GitHub';
      case 'devicePending': return 'Enter the code on GitHub';
      case 'keyPrompt':     return 'OpenAI key';
      case 'settings':      return 'Settings';
      default:              return 'Chorus';
    }
  }

  // Body
  function renderBody() {
    const el = document.createElement('div');
    el.className = 'body';
    const html = (() => {
      if (!configOK()) return configMissingHtml();
      switch (state.screen) {
        case 'browse':        return browseHtml();
        case 'propose':       return proposeHtml();
        case 'feature':       return featureHtml();
        case 'ai':            return aiHtml();
        case 'signIn':        return signInHtml();
        case 'devicePending': return devicePendingHtml();
        case 'keyPrompt':     return keyPromptHtml();
        case 'settings':      return settingsHtml();
        default:              return browseHtml();
      }
    })();
    el.innerHTML = html;
    return el;
  }

  function renderActionBar() {
    if (!configOK()) return null;
    let html = '';
    switch (state.screen) {
      case 'browse':        html = browseActions(); break;
      case 'propose':       html = proposeActions(); break;
      case 'feature':       html = featureActions(); break;
      case 'ai':            html = aiActions(); break;
      case 'signIn':        html = signInActions(); break;
      case 'devicePending': html = deviceActions(); break;
      case 'keyPrompt':     html = keyPromptActions(); break;
      case 'settings':      html = settingsActions(); break;
      default:              html = browseActions();
    }
    if (!html) return null;
    const el = document.createElement('div');
    el.className = 'action-bar';
    el.innerHTML = html;
    return el;
  }

  function configOK() { return !!CLIENT_ID && !!REPO; }

  function configMissingHtml() {
    const missing = [];
    if (!CLIENT_ID) missing.push('data-github-client-id');
    if (!REPO) missing.push('data-github-repo');
    return `<div class="err">Not configured. Missing: ${esc(missing.join(', '))}</div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Browse
  // ═══════════════════════════════════════════════════════════════
  function browseHtml() {
    const main = state.branches.find((b) => b.name === 'main' || b.name === 'master');
    const features = state.branches.filter((b) => b.name.startsWith('feature/'));
    const autos = state.branches.filter((b) => b.name.startsWith('auto/') && b !== main);
    const misc = state.branches.filter((b) => b !== main && !b.name.startsWith('feature/') && !b.name.startsWith('auto/'));
    return `
      ${whoHtml()}
      <p class="muted">Pick a branch to see its preview, discussion, and AI history — or suggest a new change.</p>
      ${state.branchesError ? `<div class="err">${esc(state.branchesError)}</div>` : ''}
      ${state.branchesLoading && !state.branches.length ? `<div class="muted-s">Loading branches…</div>` : ''}
      ${main ? `<div class="branch-list">${branchItem(main, 'main')}</div>` : ''}
      ${features.length ? `<div class="section-heading">Features</div><div class="branch-list">${features.map((b) => branchItem(b, 'feature')).join('')}</div>` : ''}
      ${autos.length ? `<div class="section-heading">Auto branches</div><div class="branch-list">${autos.map((b) => branchItem(b, 'auto')).join('')}</div>` : ''}
      ${misc.length ? `<div class="section-heading">Other</div><div class="branch-list">${misc.map((b) => branchItem(b, '')).join('')}</div>` : ''}
    `;
  }

  function branchItem(b, kind) {
    const isCurrent = state.currentBranch === b.name;
    const marker = kind === 'main' ? '<span class="marker main">main</span>'
                 : kind === 'feature' ? '<span class="marker feature">feature</span>'
                 : kind === 'auto' ? '<span class="marker auto">auto</span>'
                 : '';
    return `
      <div class="branch ${isCurrent ? 'active' : ''}" data-branch="${esc(b.name)}">
        ${marker}
        <span class="name">${esc(b.name)}</span>
        <span class="sha">${esc((b.commit?.sha || '').slice(0, 7))}</span>
      </div>
    `;
  }

  function browseActions() {
    return `
      <div class="secondary">
        <button data-action="refresh-branches">Refresh</button>
        ${preview.isShowing() ? `<button data-action="hide-preview">Hide preview</button>` : ''}
      </div>
      <button class="primary" data-action="goto-propose">✚ Suggest a change</button>
    `;
  }

  async function fetchBranches() {
    state.branchesLoading = true;
    state.branchesError = null;
    renderPanel();
    try {
      const token = auth.getToken();
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPONAME}/branches?per_page=100`,
        { headers: {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          } }
      );
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const data = await res.json();
      data.sort((a, b) => {
        if (a.name === 'main') return -1;
        if (b.name === 'main') return 1;
        return a.name.localeCompare(b.name);
      });
      state.branches = data;
    } catch (err) {
      state.branchesError = String(err.message || err);
    } finally {
      state.branchesLoading = false;
      if (state.screen === 'browse') renderPanel();
    }
  }

  function selectBranch(name) {
    state.currentBranch = name;
    state.featureBranch = name;
    // Always open a preview iframe — including for main. For the usual case
    // (editing a target site like OSSKanban) this is slightly redundant with
    // the "live site" you're already on, but it's essential for chorus-on-
    // chorus where you need to see the inner-chorus trigger render. Users
    // can always hit "Hide preview" if they don't want it.
    showBranchPreview(name);
    navigate('feature');
  }

  // Figure out the site-relative path from the host page's URL.
  // On GitHub Pages, URLs look like /<repo>/<rest-of-path>/. We strip the
  // /<repo>/ prefix so `rest-of-path` is the "within the repo" location.
  // E.g. for `marcusrobbins.github.io/chorus/test-site/` we return
  // `test-site/index.html` — which is what raw.githack needs to serve.
  function initialSitePath() {
    let rest;
    const prefix = '/' + REPONAME + '/';
    if (location.pathname.startsWith(prefix)) {
      rest = location.pathname.slice(prefix.length);
    } else {
      rest = location.pathname.replace(/^\/+/g, '');
    }
    // Directory URLs (ending in /) need an explicit index.html for raw.githack
    if (!rest || rest.endsWith('/')) rest = (rest || '') + 'index.html';
    return rest + (location.search || '') + (location.hash || '');
  }

  // Synchronous URL builder — returns SHA-pinned rawcdn URL if we already
  // have the branch SHA cached, otherwise falls back to the branch URL on
  // raw.githack (cached for 10min on its edge). Prefer showBranchPreview
  // for freshness; use this only where we can't easily go async.
  function previewUrlFor(branchName, path = state.currentPath) {
    const cached = branchShaCache.get(branchName);
    const sha = cached?.sha;
    return buildPreviewUrl({ branch: branchName, sha, path });
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Propose
  // ═══════════════════════════════════════════════════════════════
  function proposeHtml() {
    const capture = state.capture;
    const captureClass = capture ? 'capture' : 'capture empty';
    const captureText = capture
      ? `<${capture.tag}> ${capture.selector}${capture.text ? ` — \"${capture.text.slice(0, 60)}\"` : ''}`
      : 'nothing selected';
    const slugPreview = slugify(state.name);
    return `
      ${whoHtml()}
      <label class="field">
        Feature name <span class="muted-s" style="font-weight:400">(becomes the branch)</span>
        <input type="text" data-field="name" value="${esc(state.name)}" placeholder="e.g. redesign-hero" />
      </label>
      ${slugPreview ? `<div class="muted-s">Branch: <code>feature/${esc(slugPreview)}</code></div>` : ''}
      <label class="field">
        What would you like changed?
        <textarea data-field="description" placeholder="e.g. Make the hero heading bigger and add a subtitle">${esc(state.description)}</textarea>
      </label>
      <div>
        <div class="muted-s" style="margin-bottom:3px;">Selected element</div>
        <div class="${captureClass}">${esc(captureText)}</div>
      </div>
      ${state.authError ? `<div class="err">${esc(state.authError)}</div>` : ''}
    `;
  }

  function proposeActions() {
    const canSubmit = state.name.trim() && state.description.trim() && !state.filing;
    const buildLabel = state.filing ? 'Filing…' : '🤖 File & build with AI';
    return `
      <div class="secondary">
        <button data-action="pick">${state.pickMode ? 'Cancel pick' : 'Pick element'}</button>
        ${state.capture ? `<button data-action="clear-capture">Clear</button>` : ''}
        <button data-action="file-only" ${canSubmit ? '' : 'disabled'}>Just file it</button>
      </div>
      <button class="primary" data-action="file-and-build" ${canSubmit ? '' : 'disabled'}>${buildLabel}</button>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Feature detail
  // ═══════════════════════════════════════════════════════════════
  function featureHtml() {
    const branch = state.featureBranch;
    const isMain = branch === 'main' || branch === 'master';
    return `
      ${whoHtml()}
      ${state.featureMergeStatus === 'pending' ? `<div class="muted-s">Merging to main…</div>` : ''}
      ${state.featureMergeStatus?.ok ? `<div class="ok">Merged as <code>${esc(state.featureMergeStatus.sha.slice(0, 7))}</code>. Related issues closed.</div>` : ''}
      ${state.featureMergeStatus?.error ? `<div class="err">${esc(state.featureMergeStatus.error)}</div>` : ''}
      ${state.featureError ? `<div class="err">${esc(state.featureError)}</div>` : ''}
      ${state.featureLoading ? `<div class="muted-s">Loading issues referencing this branch…</div>` : ''}
      ${!state.featureLoading && state.featureIssues.length === 0 && !state.featureError
        ? `<p class="muted">No issues reference this branch${isMain ? '' : ' yet — refining it will attach one.'}</p>`
        : ''}
      ${state.featureIssues.map(renderIssue).join('')}
    `;
  }

  function renderIssue(issue) {
    const votes = issue.reactions?.['+1'] ?? 0;
    const commentsN = issue.comments ?? 0;
    const expanded = state.featureExpanded.has(issue.number);
    const draft = state.featureComposeDraft.get(issue.number) || '';
    const comments = state.featureComments.get(issue.number);
    return `
      <div class="issue" data-issue="${issue.number}">
        <div class="issue-hdr">
          <span class="n">#${issue.number}</span>
          <span class="t">${esc(issue.title)}</span>
          <span class="st ${issue.state}">${issue.state}</span>
        </div>
        <div class="issue-body">${esc((issue.body || '').slice(0, 300))}${(issue.body || '').length > 300 ? '…' : ''}</div>
        <div class="issue-actions">
          <button class="vote" data-action="vote" data-issue="${issue.number}" ${auth.isAuthed() ? '' : 'disabled title="Sign in to vote"'}>
            👍 <span>${votes}</span>
          </button>
          <button class="comments-btn" data-action="toggle-comments" data-issue="${issue.number}">
            ${expanded ? '▾' : '▸'} ${commentsN} comment${commentsN === 1 ? '' : 's'}
          </button>
          <a href="${esc(issue.html_url)}" target="_blank" rel="noopener" class="muted-s" style="margin-left:auto">open ↗</a>
        </div>
        ${expanded ? `
          <div class="comments">
            ${comments === undefined
              ? '<div class="muted-s">Loading comments…</div>'
              : comments.length
                ? comments.map(renderComment).join('')
                : '<div class="muted-s">No comments yet.</div>'}
            ${auth.isAuthed() ? `
              <div class="compose">
                <label class="field">
                  <textarea data-field="comment" data-issue="${issue.number}" placeholder="Add a comment…">${esc(draft)}</textarea>
                </label>
                <div class="compose-actions">
                  <button class="primary" data-action="post-comment" data-issue="${issue.number}" ${draft.trim() ? '' : 'disabled'} style="padding:5px 12px">Post</button>
                </div>
              </div>
            ` : `<div class="muted-s">Sign in to comment.</div>`}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderComment(c) {
    return `
      <div class="comment">
        <div class="comment-hdr">
          <img src="${esc(c.user?.avatar_url || '')}" alt="" />
          <strong>${esc(c.user?.login || '?')}</strong>
          <span>· ${esc(relativeTime(c.created_at))}</span>
        </div>
        <div class="comment-body">${esc(c.body || '')}</div>
      </div>
    `;
  }

  function featureActions() {
    const branch = state.featureBranch;
    const isMain = branch === 'main' || branch === 'master';
    const authed = auth.isAuthed();
    const showing = preview.isShowing();
    return `
      <div class="secondary">
        ${!isMain ? `<button data-action="${showing ? 'hide-preview' : 'show-preview'}">${showing ? 'Hide preview' : 'Show preview'}</button>` : ''}
        ${!isMain && authed ? `<button data-action="merge" title="Merge this branch to main">Merge</button>` : ''}
      </div>
      ${!isMain ? `<button class="primary" data-action="refine" ${authed ? '' : 'disabled title="Sign in to refine"'}>🤖 Refine with AI</button>` : `<button class="primary" data-action="goto-propose">✚ Suggest a change</button>`}
    `;
  }

  async function loadFeature(branchName) {
    state.featureBranch = branchName;
    state.featureIssues = [];
    state.featureComments = new Map();
    state.featureExpanded = new Set();
    state.featureComposeDraft = new Map();
    state.featureMergeStatus = null;
    state.featureLoading = true;
    state.featureError = null;
    renderPanel();
    try {
      const token = auth.getToken();
      const result = await gh.searchIssues(token, OWNER, REPONAME, `"${branchName}"`);
      state.featureIssues = (result.items || []).map((i) => ({
        number: i.number, title: i.title, body: i.body, state: i.state,
        html_url: i.html_url, comments: i.comments, reactions: i.reactions,
      }));
    } catch (err) {
      state.featureError = String(err.message || err);
    } finally {
      state.featureLoading = false;
      if (state.screen === 'feature') renderPanel();
    }
  }

  async function voteOnIssue(number) {
    const token = auth.getToken();
    if (!token) return;
    try {
      await gh.addIssueReaction(token, OWNER, REPONAME, number, '+1');
      const fresh = await gh.getIssue(token, OWNER, REPONAME, number);
      const idx = state.featureIssues.findIndex((i) => i.number === number);
      if (idx >= 0) state.featureIssues[idx].reactions = fresh.reactions;
      renderPanel();
    } catch (err) {
      state.featureError = `Vote failed: ${err.message || err}`;
      renderPanel();
    }
  }

  async function toggleComments(number) {
    if (state.featureExpanded.has(number)) {
      state.featureExpanded.delete(number);
      renderPanel(); return;
    }
    state.featureExpanded.add(number);
    renderPanel();
    if (!state.featureComments.has(number)) {
      try {
        const token = auth.getToken();
        const comments = await gh.listIssueComments(token, OWNER, REPONAME, number);
        state.featureComments.set(number, comments);
      } catch (err) {
        state.featureComments.set(number, []);
        state.featureError = `Could not load comments: ${err.message || err}`;
      }
      renderPanel();
    }
  }

  async function postComment(number) {
    const body = (state.featureComposeDraft.get(number) || '').trim();
    if (!body) return;
    const token = auth.getToken();
    if (!token) return;
    try {
      await gh.createIssueComment(token, OWNER, REPONAME, number, body);
      state.featureComposeDraft.set(number, '');
      const comments = await gh.listIssueComments(token, OWNER, REPONAME, number);
      state.featureComments.set(number, comments);
      const idx = state.featureIssues.findIndex((i) => i.number === number);
      if (idx >= 0) state.featureIssues[idx].comments = comments.length;
      renderPanel();
    } catch (err) {
      state.featureError = `Comment failed: ${err.message || err}`;
      renderPanel();
    }
  }

  async function mergeCurrent() {
    const branch = state.featureBranch;
    const token = auth.getToken();
    if (!token || !branch) return;
    state.featureMergeStatus = 'pending';
    renderPanel();
    try {
      const result = await gh.mergeBranch(token, OWNER, REPONAME, {
        base: 'main', head: branch,
        commit_message: `Merge '${branch}' via Chorus`,
      });
      if (!result || !result.sha) {
        state.featureMergeStatus = { error: 'Nothing to merge (branch is up to date).' };
        renderPanel(); return;
      }
      for (const issue of state.featureIssues) {
        if (issue.state === 'open') {
          await gh.setIssueState(token, OWNER, REPONAME, issue.number, 'closed').catch(() => {});
        }
      }
      state.featureMergeStatus = { ok: true, sha: result.sha };
      await loadFeature(branch);
      fetchBranches();
    } catch (err) {
      state.featureMergeStatus = { error: String(err.message || err) };
      renderPanel();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: AI session
  // ═══════════════════════════════════════════════════════════════
  function aiHtml() {
    const s = state.ai;
    if (!s) return '<div class="muted-s">No active session.</div>';
    const capture = state.capture;
    const captureClass = capture ? 'capture' : 'capture empty';
    const captureText = capture
      ? `<${capture.tag}> ${capture.selector}${capture.text ? ` — \"${capture.text.slice(0, 60)}\"` : ''}`
      : 'nothing selected';
    return `
      ${s.summary ? `<div class="ok"><strong>Last turn:</strong> ${esc(s.summary)}</div>` : ''}
      ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      ${s.events?.length ? `<div class="log">${s.events.map(renderAiEvent).join('')}${s.status === 'committing' ? '<div class="log-line muted">⏳ committing…</div>' : ''}</div>` : ''}
      ${s.status === 'done' || s.status === 'error' ? `
        <label class="field">
          Refine — what next?
          <textarea data-field="followup" placeholder="e.g. make the heading bolder · add a subtitle">${esc(s.followUpDraft || '')}</textarea>
        </label>
        <div>
          <div class="muted-s" style="margin-bottom:3px;">Selected element${capture ? ' (will be included as context)' : ''}</div>
          <div class="${captureClass}">${esc(captureText)}</div>
        </div>
      ` : ''}
    `;
  }

  function renderAiEvent(e) {
    if (e.type === 'thinking')       return `<div class="log-line muted">→ thinking… (${e.iteration + 1})</div>`;
    if (e.type === 'tool_call')      return `<div class="log-line">→ <strong>${esc(e.name)}</strong>(${esc(shortArgs(e.args))})</div>`;
    if (e.type === 'tool_result')    return `<div class="log-line muted">  ← ${esc(JSON.stringify(e.result))}</div>`;
    if (e.type === 'tool_error')     return `<div class="log-line err-inline" style="color:#a00">  ← error: ${esc(e.error)}</div>`;
    if (e.type === 'finish')         return `<div class="log-line">✓ finish — ${esc(e.summary)}</div>`;
    if (e.type === 'assistant_text' && e.text) return `<div class="log-line muted">"${esc(e.text.slice(0, 200))}${e.text.length > 200 ? '…' : ''}"</div>`;
    if (e.type === 'iteration_limit') return `<div class="log-line" style="color:#a00">⚠ hit iteration limit</div>`;
    if (e.type === 'stopped_without_finish') return `<div class="log-line" style="color:#a00">⚠ stopped without calling finish</div>`;
    return '';
  }

  function shortArgs(args) {
    const s = JSON.stringify(args || {});
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  }

  function aiActions() {
    const s = state.ai;
    if (!s) return `<button class="primary" data-action="back">Back</button>`;
    if (s.status === 'running' || s.status === 'committing') {
      return `<div class="secondary"></div><button class="primary" data-action="ai-cancel">Cancel</button>`;
    }
    const hasDraft = (s.followUpDraft || '').trim().length > 0;
    const showing = preview.isShowing();
    return `
      <div class="secondary">
        <button data-action="pick">${state.pickMode ? 'Cancel pick' : 'Pick element'}</button>
        ${state.capture ? `<button data-action="clear-capture">Clear</button>` : ''}
        <button data-action="${showing ? 'hide-preview' : 'show-preview'}">${showing ? 'Hide preview' : 'Show preview'}</button>
        <button data-action="open-in-new-tab">Open in new tab</button>
      </div>
      <button class="primary" data-action="ai-continue" ${hasDraft ? '' : 'disabled'}>Continue</button>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Sign-in (interstitial)
  // ═══════════════════════════════════════════════════════════════
  function signInHtml() {
    return `
      <p>To propose changes, vote, and run the AI you need to sign in with GitHub. Your token is kept in this tab's memory only.</p>
      ${state.authError ? `<div class="err">${esc(state.authError)}</div>` : ''}
    `;
  }
  function signInActions() {
    return `
      <div class="secondary"></div>
      <button class="primary" data-action="sign-in">Sign in with GitHub</button>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Device-flow pending
  // ═══════════════════════════════════════════════════════════════
  function devicePendingHtml() {
    const df = state.deviceFlow;
    if (!df) return '';
    return `
      <p>Open <a href="${esc(df.verificationUri)}" target="_blank" rel="noopener">${esc(df.verificationUri)}</a> and enter this code:</p>
      <div class="device-code">${esc(df.userCode)}</div>
      <div class="muted-s">Waiting for authorisation…</div>
    `;
  }
  function deviceActions() {
    return `<div class="secondary"></div><button class="primary" data-action="cancel-device">Cancel</button>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: OpenAI key prompt
  // ═══════════════════════════════════════════════════════════════
  function keyPromptHtml() {
    return `
      <p>Paste your OpenAI API key. Kept in this tab's memory, sent directly from your browser to OpenAI.</p>
      <label class="field">
        OpenAI API key
        <input type="password" class="key-input" data-field="openai-key" placeholder="sk-…" autocomplete="off" />
      </label>
      <p class="muted-s">Use a key with a low spend cap. This tool doesn't enforce a budget.</p>
    `;
  }
  function keyPromptActions() {
    return `<div class="secondary"></div><button class="primary" data-action="save-key">Save & continue</button>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Settings
  // ═══════════════════════════════════════════════════════════════
  function settingsHtml() {
    return `
      ${whoHtml()}
      <div>
        <div class="muted-s">OpenAI key</div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:3px;">
          <span class="capture">${state.openaiKey ? '●●●●●●●●' + esc(state.openaiKey.slice(-4)) : '(none set)'}</span>
          ${state.openaiKey ? `<button data-action="clear-key" style="background:transparent; border:none; color:#a00; cursor:pointer; font-size:12px;">Clear</button>` : ''}
        </div>
      </div>
      <p class="muted-s">Both credentials clear when you close this tab.</p>