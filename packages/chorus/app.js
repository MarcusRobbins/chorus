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
  .action-bar .secondary { display: flex; gap: 6px; flex-wrap: wrap; }
  .action-bar .secondary button {
    background: #fff; border: 1px solid #ddd; color: #333;
    font: inherit; font-size: 12px; cursor: pointer;
    padding: 5px 10px; border-radius: 5px;
    transition: background .12s ease, border-color .12s ease;
  }
  .action-bar .secondary button:hover {
    background: #f4f4f4; border-color: #bbb;
  }
  .action-bar .primary {
    font: inherit; font-size: 13px; font-weight: 500;
    padding: 8px 16px; border-radius: 6px; cursor: pointer;
    background: #111; color: #fff; border: 1px solid #111;
  }
  .action-bar .primary:disabled { background: #aaa; border-color: #aaa; cursor: default; }
  .action-bar .primary.green { background: #2a6; border-color: #2a6; }
  .action-bar .primary:hover:not(:disabled) { background: #222; }

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
  const DEFAULT_MODEL = script?.dataset?.openaiModel || 'gpt-5.4';
  // Curated shortlist for the Settings dropdown. The freeform "Custom…" option
  // lets users type any model string (OpenAI adds them faster than we can
  // update this list). Order = newest → oldest-but-still-useful.
  const MODEL_OPTIONS = [
    'gpt-5.4',
    'gpt-5',
    'gpt-5-mini',
    'gpt-4.1',
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o3-mini',
    'o4-mini',
  ];
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
  // data-auto-preview: open a preview iframe of the current branch on boot.
  // Regular embeds (OSSKanban, etc.) can opt in to have the preview show
  // immediately rather than requiring the user to click a branch.
  const AUTO_PREVIEW = script?.dataset?.autoPreview === 'true';
  // data-chorus-meta: "this is the chorus-on-chorus demo". Forces the preview
  // iframe to stay windowed always, so the outer and inner chorus pills don't
  // collide at bottom-right. Independent from AUTO_PREVIEW — a site may want
  // auto-opened previews without the always-windowed behaviour.
  const CHORUS_META = script?.dataset?.chorusMeta === 'true';
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
  const savedModel = storeLoad('openaiModel');

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
    openaiModel: savedModel || DEFAULT_MODEL,

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
  // Meta mode = chorus-on-chorus demo — iframe stays windowed permanently.
  // Decoupled from AUTO_PREVIEW so non-demo embeds that also want to auto-
  // open the preview (e.g. OSSKanban) can still get the "full on init,
  // shrink when panel opens" behaviour.
  const IS_META = !inIframe && CHORUS_META;

  // Is the iframe currently in a "get out of the way" state?
  //  - Chorus-on-chorus (meta): always windowed. The demo relies on seeing
  //    both outer and inner chorus at once.
  //  - Normal embeds (OSSKanban etc.): windowed only when the chorus panel
  //    is open. Otherwise full-viewport, so the branch preview reads as
  //    "the site", not a small inset. Transitions smoothly when the user
  //    opens/closes the panel.
  function wantWindowed() {
    return IS_META || state.open;
  }

  // All preview-iframe opens route through this helper so the mode is
  // computed consistently from state.
  function showPreviewFrame(url) {
    if (DEBUG) {
      // Trace who called us so we can diagnose runaway loops.
      console.log('[chorus] showPreviewFrame →', url);
      console.trace('[chorus] caller');
    }
    preview.show(url, { windowed: wantWindowed() });
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
    let cleanPath = String(path || 'index.html').replace(/^\/+/, '');
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
    // Non-meta: shrink the preview iframe to windowed mode so the panel
    // and the underlying site are both visible. Meta stays windowed.
    if (DEBUG) console.log('[chorus] openPanel → setWindowed', wantWindowed(), { IS_META, hasIframe: preview.isShowing() });
    preview.setWindowed(wantWindowed());
    renderPanel();
  }
  function closePanel() {
    state.open = false;
    panelEl?.remove(); panelEl = null;
    trigger.style.display = '';
    // Expand the preview back to full on non-meta when there's nothing
    // else to compete for screen real estate.
    if (DEBUG) console.log('[chorus] closePanel → setWindowed', wantWindowed(), { IS_META, hasIframe: preview.isShowing() });
    preview.setWindowed(wantWindowed());
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
      rest = location.pathname.replace(/^\/+/, '');
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
      ? `<${capture.tag}> ${capture.selector}${capture.text ? ` — "${capture.text.slice(0, 60)}"` : ''}`
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
    return `
      <div class="secondary">
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
      ? `<${capture.tag}> ${capture.selector}${capture.text ? ` — "${capture.text.slice(0, 60)}"` : ''}`
      : 'nothing selected';
    const modelInUse = state.openaiModel || DEFAULT_MODEL;
    return `
      <div class="muted-s">Model: <code>${esc(modelInUse)}</code> · <button style="background:transparent;border:none;color:#0366d6;cursor:pointer;padding:0;font-size:11px;" data-action="goto-settings">change</button></div>
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
    // When there's text in "Refine — what next?", the primary action is to
    // send that to the AI. When there isn't, the user is done — the primary
    // is "Open the feature branch" (where they can merge / discuss).
    const primary = hasDraft
      ? `<button class="primary" data-action="ai-continue">Send refinement</button>`
      : `<button class="primary green" data-action="ai-done">Done — view branch</button>`;
    return `
      <div class="secondary">
        <button data-action="pick">${state.pickMode ? 'Cancel pick' : 'Pick element'}</button>
      </div>
      ${primary}
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
    const currentModel = state.openaiModel || DEFAULT_MODEL;
    const isCustom = !MODEL_OPTIONS.includes(currentModel);
    const selectValue = isCustom ? '__custom__' : currentModel;
    return `
      ${whoHtml()}
      <div>
        <div class="muted-s">OpenAI key</div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:3px;">
          <span class="capture">${state.openaiKey ? '●●●●●●●●' + esc(state.openaiKey.slice(-4)) : '(none set)'}</span>
          ${state.openaiKey ? `<button data-action="clear-key" style="background:transparent; border:none; color:#a00; cursor:pointer; font-size:12px;">Clear</button>` : ''}
        </div>
      </div>
      <label class="field">
        Model
        <select data-field="model">
          ${MODEL_OPTIONS.map((m) => `<option value="${esc(m)}" ${m === selectValue ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          <option value="__custom__" ${selectValue === '__custom__' ? 'selected' : ''}>Custom…</option>
        </select>
      </label>
      ${isCustom || selectValue === '__custom__' ? `
        <label class="field" style="margin-top:-4px;">
          <span class="muted-s">Custom model string</span>
          <input data-field="model-custom" type="text" placeholder="e.g. gpt-5.4-turbo" value="${esc(currentModel)}" />
        </label>
      ` : ''}
      <p class="muted-s">Default is <code>${esc(DEFAULT_MODEL)}</code>. Unknown models will 404 at OpenAI.</p>
      <p class="muted-s">All credentials clear when you close this tab.</p>
    `;
  }
  function settingsActions() {
    if (!auth.isAuthed()) {
      return `<div class="secondary"></div><button class="primary" data-action="sign-in">Sign in with GitHub</button>`;
    }
    return `<div class="secondary"></div><button class="primary" data-action="sign-out">Sign out</button>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Wiring
  // ═══════════════════════════════════════════════════════════════
  function wirePanel() {
    if (!panelEl) return;
    const on = (sel, ev, fn) => panelEl.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

    // Header
    on('[data-action="back"]', 'click', goBack);
    on('[data-action="close"]', 'click', closePanel);

    // Browse
    panelEl.querySelectorAll('.branch').forEach((el) => {
      el.addEventListener('click', () => selectBranch(el.dataset.branch));
    });
    on('[data-action="refresh-branches"]', 'click', fetchBranches);
    on('[data-action="goto-propose"]', 'click', () => {
      if (!requireAuth('propose')) return;
      navigate('propose');
    });

    // Propose
    const nameInput = panelEl.querySelector('[data-field="name"]');
    nameInput?.addEventListener('input', (e) => {
      state.name = e.target.value;
      renderPanel();
      // re-focus after re-render
      const n = panelEl?.querySelector('[data-field="name"]');
      if (n) { n.focus(); const l = n.value.length; n.setSelectionRange(l, l); }
    });
    const descInput = panelEl.querySelector('[data-field="description"]');
    descInput?.addEventListener('input', (e) => {
      state.description = e.target.value;
      // Don't re-render; just update the submit button state
      const b = panelEl.querySelector('[data-action="file-and-build"]');
      const b2 = panelEl.querySelector('[data-action="file-only"]');
      const ok = state.name.trim() && state.description.trim();
      if (b) b.disabled = !ok || state.filing;
      if (b2) b2.disabled = !ok || state.filing;
    });
    on('[data-action="pick"]', 'click', () => state.pickMode ? exitPickMode() : enterPickMode());
    on('[data-action="clear-capture"]', 'click', () => { state.capture = null; renderPanel(); });
    on('[data-action="file-and-build"]', 'click', () => submitTicket(true));
    on('[data-action="file-only"]', 'click', () => submitTicket(false));

    // Feature
    on('[data-action="refine"]', 'click', () => {
      if (!requireAuth('ai')) return;
      if (!state.openaiKey) { navigate('keyPrompt'); state.pendingIntent = 'refine'; return; }
      startRefine();
    });
    on('[data-action="merge"]', 'click', mergeCurrent);
    panelEl.querySelectorAll('[data-action="vote"]').forEach((el) => {
      el.addEventListener('click', () => voteOnIssue(Number(el.dataset.issue)));
    });
    panelEl.querySelectorAll('[data-action="toggle-comments"]').forEach((el) => {
      el.addEventListener('click', () => toggleComments(Number(el.dataset.issue)));
    });
    panelEl.querySelectorAll('[data-field="comment"]').forEach((ta) => {
      ta.addEventListener('input', (e) => {
        const n = Number(e.target.dataset.issue);
        state.featureComposeDraft.set(n, e.target.value);
        const btn = panelEl.querySelector(`[data-action="post-comment"][data-issue="${n}"]`);
        if (btn) btn.disabled = !e.target.value.trim();
      });
    });
    panelEl.querySelectorAll('[data-action="post-comment"]').forEach((el) => {
      el.addEventListener('click', () => postComment(Number(el.dataset.issue)));
    });

    // AI
    const fu = panelEl.querySelector('[data-field="followup"]');
    fu?.addEventListener('input', (e) => {
      const prev = (state.ai?.followUpDraft || '').trim().length > 0;
      const now = e.target.value.trim().length > 0;
      if (state.ai) state.ai.followUpDraft = e.target.value;
      // Swap the primary button (Send refinement ↔ Done — view branch) only
      // on the draft → empty / empty → draft transitions. Avoids re-rendering
      // the whole panel on every keystroke, which would steal focus from the
      // textarea.
      if (prev !== now) {
        const bar = panelEl.querySelector('.action-bar');
        if (bar) {
          renderPanel(); // full re-render is simplest; caret preserved below
          const again = panelEl.querySelector('[data-field="followup"]');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }
      }
    });
    on('[data-action="ai-continue"]', 'click', continueAi);
    on('[data-action="ai-cancel"]', 'click', () => aiAbortController?.abort());
    on('[data-action="ai-done"]', 'click', () => {
      if (state.ai?.branch) {
        loadFeature(state.ai.branch);
        navigate('feature');
      } else {
        goBack();
      }
    });

    // Sign-in
    on('[data-action="sign-in"]', 'click', startDeviceFlow);
    on('[data-action="cancel-device"]', 'click', cancelDeviceFlow);

    // Key prompt
    const key = panelEl.querySelector('[data-field="openai-key"]');
    if (key && state.openaiKey) key.value = state.openaiKey;
    on('[data-action="save-key"]', 'click', () => {
      const v = panelEl.querySelector('[data-field="openai-key"]')?.value?.trim();
      if (!v) return;
      state.openaiKey = v; storeSave('openaiKey', v);
      const intent = state.pendingIntent; state.pendingIntent = null;
      if (intent === 'refine') startRefine();
      else if (intent === 'build') beginFirstAiTurn();
      else navigate('browse', { reset: true });
    });

    // Settings
    on('[data-action="sign-out"]', 'click', signOut);
    on('[data-action="clear-key"]', 'click', () => { state.openaiKey = null; storeClear('openaiKey'); renderPanel(); });
    // Model selector: dropdown picks from the shortlist OR switches to the
    // custom-text input. The custom input is debounced-saved on every
    // keystroke so there's nothing to "confirm".
    const modelSelect = panelEl.querySelector('[data-field="model"]');
    modelSelect?.addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__custom__') {
        // Re-render so the custom-string input appears; keep current value.
        renderPanel();
        panelEl?.querySelector('[data-field="model-custom"]')?.focus();
      } else {
        state.openaiModel = v;
        storeSave('openaiModel', v);
        renderPanel();
      }
    });
    const modelCustom = panelEl.querySelector('[data-field="model-custom"]');
    modelCustom?.addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (!v) return;
      state.openaiModel = v;
      storeSave('openaiModel', v);
    });

    // Settings link in the who strip (appears on multiple screens)
    on('[data-action="goto-settings"]', 'click', () => navigate('settings'));
  }

  // ═══════════════════════════════════════════════════════════════
  // Element picker (outer — with in-iframe delegation)
  // ═══════════════════════════════════════════════════════════════
  let overlayEl = null, hintEl = null;

  function enterPickMode() {
    if (state.pickMode) return;
    // Delegate into preview iframe if showing
    if (DEBUG) {
      console.log('[chorus] enterPickMode', {
        previewShowing: preview.isShowing(),
        hasIframe: !!document.getElementById('oss-kanban-preview-iframe'),
      });
    }
    if (preview.isShowing()) {
      const iframe = document.getElementById('oss-kanban-preview-iframe');
      if (iframe?.contentWindow) {
        state.pickMode = true;
        closePanel();
        try {
          if (DEBUG) console.log('[chorus] → postMessage start-pick to iframe');
          iframe.contentWindow.postMessage({ type: 'chorus:parent:start-pick' }, '*');
        } catch (err) {
          if (DEBUG) console.log('[chorus] postMessage failed', err);
          state.pickMode = false;
        }
        return;
      }
    }
    // Pick on the host page
    state.pickMode = true;
    closePanel();
    overlayEl = document.createElement('div');
    overlayEl.className = 'overlay';
    overlayEl.style.display = 'none';
    root.appendChild(overlayEl);
    hintEl = document.createElement('div');
    hintEl.className = 'hint';
    hintEl.textContent = 'Click any element · Esc to cancel';
    root.appendChild(hintEl);
    document.addEventListener('mousemove', onPickHover, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
  }

  function exitPickMode() {
    if (!state.pickMode) return;
    // Cancel in iframe too
    const iframe = document.getElementById('oss-kanban-preview-iframe');
    if (iframe?.contentWindow && preview.isShowing()) {
      try { iframe.contentWindow.postMessage({ type: 'chorus:parent:cancel-pick' }, '*'); } catch {}
    }
    state.pickMode = false;
    overlayEl?.remove(); overlayEl = null;
    hintEl?.remove(); hintEl = null;
    document.removeEventListener('mousemove', onPickHover, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
    openPanel();
  }

  function onPickHover(e) {
    if (isOurs(e.target)) { overlayEl.style.display = 'none'; return; }
    const r = e.target.getBoundingClientRect();
    overlayEl.style.display = 'block';
    overlayEl.style.left = r.left + 'px';
    overlayEl.style.top = r.top + 'px';
    overlayEl.style.width = r.width + 'px';
    overlayEl.style.height = r.height + 'px';
  }
  function onPickClick(e) {
    if (isOurs(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target; const r = el.getBoundingClientRect();
    state.capture = {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      text: (el.innerText || '').trim().slice(0, 200),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      url: location.href,
    };
    state.pickMode = false;
    overlayEl?.remove(); overlayEl = null;
    hintEl?.remove(); hintEl = null;
    document.removeEventListener('mousemove', onPickHover, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
    openPanel();
  }
  function onPickKey(e) { if (e.key === 'Escape') exitPickMode(); }
  function isOurs(el) { return host.contains(el) || el === host; }

  // ═══════════════════════════════════════════════════════════════
  // GitHub device flow
  // ═══════════════════════════════════════════════════════════════
  let devicePollAbort = null;

  async function startDeviceFlow() {
    state.authError = null;
    try {
      const res = await fetch(DEVICE_CODE_URL, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
      });
      if (!res.ok) throw new Error(`device/code ${res.status}`);
      const data = await res.json();
      state.deviceFlow = {
        deviceCode: data.device_code, userCode: data.user_code,
        verificationUri: data.verification_uri,
        interval: (data.interval || 5) * 1000,
        expiresAt: Date.now() + (data.expires_in || 900) * 1000,
      };
      state.auth = 'device-pending';
      navigate('devicePending');
      pollForToken();
    } catch (err) {
      state.authError = `Could not start GitHub auth: ${err.message || err}`;
      state.auth = 'error';
      renderPanel();
    }
  }

  async function pollForToken() {
    const df = state.deviceFlow; if (!df) return;
    devicePollAbort = new AbortController();
    let interval = df.interval;
    while (Date.now() < df.expiresAt) {
      await sleep(interval, devicePollAbort.signal);
      if (devicePollAbort.signal.aborted) return;
      try {
        const res = await fetch(OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: df.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          signal: devicePollAbort.signal,
        });
        const data = await res.json();
        if (data.error === 'authorization_pending') continue;
        if (data.error === 'slow_down') { interval += 5000; continue; }
        if (data.error) throw new Error(data.error_description || data.error);
        if (data.access_token) {
          state.token = data.access_token;
          state.deviceFlow = null;
          state.auth = 'authed';
          try { state.user = await gh.fetchUser(state.token); } catch {}
          auth.setAuth(state.token, state.user);
          storeSave('token', state.token);
          storeSave('user', state.user);
          // Respect pending intent
          const intent = state.pendingIntent; state.pendingIntent = null;
          if (intent === 'propose') navigate('propose', { reset: true });
          else if (intent === 'refine') startRefine();
          else navigate('browse', { reset: true });
          return;
        }
      } catch (err) {
        if (devicePollAbort.signal.aborted) return;
        state.auth = 'error';
        state.authError = `GitHub auth failed: ${err.message || err}`;
        state.deviceFlow = null;
        renderPanel();
        return;
      }
    }
    state.auth = 'error';
    state.authError = 'Auth code expired. Try again.';
    state.deviceFlow = null;
    navigate('signIn', { reset: true });
  }

  function cancelDeviceFlow() {
    devicePollAbort?.abort();
    devicePollAbort = null;
    state.auth = 'idle';
    state.deviceFlow = null;
    navigate('browse', { reset: true });
  }

  function signOut() {
    state.token = null; state.user = null;
    state.auth = 'idle'; state.authError = null;
    auth.clearAuth();
    storeClear('token'); storeClear('user');
    navigate('browse', { reset: true });
  }

  // ═══════════════════════════════════════════════════════════════
  // Ticket filing
  // ═══════════════════════════════════════════════════════════════
  async function submitTicket(thenBuild) {
    if (!auth.isAuthed()) { state.pendingIntent = 'propose'; navigate('signIn'); return; }
    if (!state.name.trim() || !state.description.trim()) return;
    state.filing = true;
    renderPanel();
    try {
      const slug = slugify(state.name);
      const meta = { schema: 1, featureName: state.name, featureSlug: slug, annotation: state.capture };
      const body =
        state.description.trim() + '\n\n' +
        `Feature branch: \`feature/${slug}\`\n\n` +
        '<details>\n<summary>Ticket metadata</summary>\n\n' +
        '```json\n' + JSON.stringify(meta, null, 2) + '\n```\n' +
        '</details>\n';
      const title = state.name.trim().slice(0, 72);
      const issue = await gh.createIssue(state.token, OWNER, REPONAME, { title, body });

      if (thenBuild) {
        // Ensure OpenAI key
        if (!state.openaiKey) {
          state.pendingIntent = 'build';
          state._pendingIssue = issue;
          state.filing = false;
          navigate('keyPrompt');
          return;
        }
        state._pendingIssue = issue;
        state.filing = false;
        beginFirstAiTurn();
      } else {
        state.filing = false;
        // Reset form, go to feature detail for the (not-yet-existing) branch.
        state.featureBranch = `feature/${slug}`;
        state.name = ''; state.description = ''; state.capture = null;
        await loadFeature(state.featureBranch);
        navigate('feature', { reset: true });
      }
    } catch (err) {
      state.filing = false;
      state.authError = `Could not file issue: ${err.message || err}`;
      renderPanel();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AI session
  // ═══════════════════════════════════════════════════════════════
  let aiAbortController = null;

  async function beginFirstAiTurn() {
    const issue = state._pendingIssue;
    state._pendingIssue = null;
    if (!issue) return;
    const slug = slugify(state.name || '') || `issue-${issue.number}`;

    state.ai = {
      issueNumber: issue.number,
      status: 'running',
      events: [],
      staged: new Map(),
      messages: null,
      turn: 1,
      summary: null,
      branch: null,
      workingRef: null,
      previewUrl: null,
      followUpDraft: '',
      error: null,
    };
    navigate('ai', { reset: true });

    aiAbortController = new AbortController();
    const repoMeta = await safe(() => gh.getRepo(state.token, OWNER, REPONAME));
    if (!repoMeta) return aiFail('Could not read repository metadata.');
    const defaultBranch = repoMeta.default_branch || 'main';
    state.ai.workingRef = defaultBranch;

    const userPrompt = buildFirstTurnPrompt(issue, state.description, state.capture, defaultBranch);
    try {
      const result = await runAiSession({
        apiKey: state.openaiKey, model: state.openaiModel || DEFAULT_MODEL,
        userPrompt,
        signal: aiAbortController.signal,
        onEvent: pushAiEvent,
        executeTool: (name, args) => executeTool(name, args),
      });
      await commitAndSurface(result, issue, true, defaultBranch);
      // Reset form state for future propose
      state.name = ''; state.description = ''; state.capture = null;
    } catch (err) {
      if (aiAbortController.signal.aborted) return aiFail('Cancelled.');
      aiFail(err.message || String(err));
    }
  }

  function startRefine() {
    const branch = state.featureBranch;
    if (!branch) return;
    // Find associated issue (first one we've loaded)
    const issue = state.featureIssues[0] || null;
    state.ai = {
      issueNumber: issue?.number ?? null,
      status: 'done',
      events: [],
      staged: new Map(),
      messages: null,
      turn: 0,
      summary: null,
      branch,
      workingRef: branch,
      previewUrl: previewUrlFor(branch), // may be branch URL; refreshed post-commit
      followUpDraft: '',
      error: null,
    };
    if (issue) {
      state.ai.issueHtmlUrl = issue.html_url;
    }
    // Pre-show the preview so user sees the current branch state.
    // Resolve the SHA asynchronously so we hit rawcdn (immutable) not
    // raw.githack (10-min edge cache).
    showBranchPreview(branch).then((url) => { if (state.ai) state.ai.previewUrl = url; });
    navigate('ai');
  }

  async function continueAi() {
    if (!state.ai?.branch) return;
    const followUp = (state.ai.followUpDraft || '').trim();
    if (!followUp) return;
    if (!state.openaiKey) {
      state.pendingIntent = 'refine';
      navigate('keyPrompt');
      return;
    }

    state.ai.events = [];
    state.ai.staged = new Map();
    state.ai.status = 'running';
    state.ai.turn = (state.ai.turn || 0) + 1;
    state.ai.error = null;
    renderPanel();

    aiAbortController = new AbortController();
    try {
      const captureSuffix = state.capture
        ? '\n\n' + captureHint(state.capture)
        : '';
      const followUpWithCapture = followUp + captureSuffix;
      const hasHistory = Array.isArray(state.ai.messages) && state.ai.messages.length > 0;
      const runArgs = hasHistory
        ? { priorMessages: state.ai.messages, followUp: followUpWithCapture }
        : { userPrompt: buildRefinePrompt(state.ai.branch, followUpWithCapture) };
      const result = await runAiSession({
        apiKey: state.openaiKey, model: state.openaiModel || DEFAULT_MODEL,
        ...runArgs,
        signal: aiAbortController.signal,
        onEvent: pushAiEvent,
        executeTool: (name, args) => executeTool(name, args),
      });
      // Find issue for commit comment
      const issueFallback = { number: state.ai.issueNumber, html_url: state.ai.issueHtmlUrl };
      await commitAndSurface(result, issueFallback, false, null);
      state.ai.followUpDraft = '';
      state.capture = null;
    } catch (err) {
      if (aiAbortController.signal.aborted) return aiFail('Cancelled.');
      aiFail(err.message || String(err));
    }
  }

  async function commitAndSurface(result, issue, firstTurn, defaultBranch) {
    state.ai.messages = result.messages;
    if (!state.ai.staged.size) {
      state.ai.status = 'done';
      state.ai.summary = result.summary || '(no changes this turn)';
      renderPanel();
      return;
    }
    state.ai.status = 'committing';
    renderPanel();
    const branch = firstTurn
      ? `feature/${slugify(state.name) || 'issue-' + (issue?.number || Date.now().toString(36))}`
      : state.ai.branch;
    const commitMessage = result.summary
      ? `${result.summary}\n\nRefs #${issue?.number ?? ''}`
      : `AI edits (turn ${state.ai.turn})`;
    const commitRes = await gh.commitFiles(state.token, OWNER, REPONAME, {
      branch, startFrom: firstTurn ? defaultBranch : undefined,
      message: commitMessage, files: state.ai.staged,
    });
    // Update our SHA cache to the brand-new commit so subsequent
    // showBranchPreview / previewUrlFor calls use the immutable rawcdn URL.
    if (commitRes?.sha) branchShaCache.set(branch, { sha: commitRes.sha, fetchedAt: Date.now() });
    const previewPath = state.currentPath || 'index.html';
    const previewUrl = buildPreviewUrl({ branch, sha: commitRes?.sha, path: previewPath });
    if (issue?.number) {
      await safe(() => gh.createIssueComment(
        state.token, OWNER, REPONAME, issue.number,
        firstTurn
          ? `AI built a candidate on branch \`${branch}\`.\n\nPreview: ${previewUrl}${result.summary ? '\n\nSummary: ' + result.summary : ''}`
          : `Turn ${state.ai.turn} on \`${branch}\`${result.summary ? ': ' + result.summary : ''}`
      ));
    }
    state.ai.branch = branch;
    state.ai.workingRef = branch;
    state.ai.previewUrl = previewUrl;
    state.ai.summary = result.summary;
    state.ai.status = 'done';

    // Always show/refresh preview with the SHA-pinned URL. rawcdn is
    // immutable so there's no cache to bust — but we still call show
    // with a fresh URL so the iframe actually navigates.
    showPreviewFrame(previewUrl);
    renderPanel();
  }

  function aiFail(msg) {
    if (state.ai) { state.ai.error = msg; state.ai.status = 'error'; }
    renderPanel();
  }
  function pushAiEvent(ev) {
    if (!state.ai) return;
    state.ai.events.push(ev);
    if (state.screen === 'ai' && (state.ai.status === 'running' || state.ai.status === 'committing')) {
      renderPanel();
    }
    log('ai', ev);
  }

  // Build an explicit hint block when the user annotated an element that
  // turned out to be INSIDE a shadow root. The selector we captured contains
  // a `::shadow` marker in that case. Shadow-DOM elements aren't in HTML —
  // they come from JS that imperatively renders into a shadow root (widgets,
  // web components, embedded tools). The most reliable way for the AI to
  // find them is to grep the repo's JS for the visible text snippet, not
  // chase the selector.
  function captureHint(capture) {
    if (!capture) return 'No element annotation.';
    const inShadow = typeof capture.selector === 'string' && capture.selector.includes('::shadow');
    const text = (capture.text || '').trim();
    const base = `Annotated element: ${JSON.stringify(capture, null, 2)}`;
    if (!inShadow) return base;
    return [
      base,
      '',
      'IMPORTANT: this element is inside a Web Component shadow root (note the ::shadow segment in the selector). It is NOT in a static HTML file.',
      'It is rendered by JavaScript that attaches a shadow root and writes template strings or DOM into it — commonly a widget or tool bundled into the page.',
      text
        ? `To locate the source: list_files, then for each plausible JS file use read_file and search the returned contents for the exact literal text ${JSON.stringify(text)}. You MUST confirm that string appears in the file before editing it — a file name or file size alone is not enough. Keep reading more files until you find the one that actually contains the string.`
        : 'To locate the source: read the JS files that attach shadow roots and find the element by its tag/class from the selector.',
      'Do NOT satisfy this ticket by editing top-level HTML/CSS unless you have confirmed the element actually lives there — shadow roots are isolated from outer CSS.',
      'Do NOT write_file to any JS file you have not read and verified contains the relevant text/selector. If your first candidate file does not contain it, read another.',
    ].join('\n');
  }

  function buildFirstTurnPrompt(issue, description, capture, defaultBranch) {
    return [
      `Feature: ${state.name}`,
      `Ticket: ${description.trim()}`,
      '',
      `Issue number: ${issue.number}`,
      `Working branch: feature/${slugify(state.name)}`,
      `Repo default branch: ${defaultBranch}`,
      captureHint(capture),
      '',
      'Use list_files first to see what is in the repo. Read relevant files, then stage changes with write_file, then call finish.',
    ].join('\n');
  }

  function buildRefinePrompt(branch, followUp) {
    return [
      `You are continuing work on an existing feature branch: \`${branch}\`.`,
      '',
      `Use list_files and read_file (they default to the ${branch} branch) to see the current state.`,
      `Then apply the requested change by staging edits with write_file, and call finish when done.`,
      '',
      `User's request:`,
      followUp,
    ].join('\n');
  }

  async function executeTool(name, args) {
    const workingRef = state.ai?.workingRef || 'main';
    if (name === 'list_files') {
      const ref = args.ref || workingRef;
      const tree = await gh.listTree(state.token, OWNER, REPONAME, ref);
      return (tree.tree || []).filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 }));
    }
    if (name === 'read_file') {
      const ref = args.ref || workingRef;
      const content = await gh.readFile(state.token, OWNER, REPONAME, args.path, ref);
      if (content === null) return { error: `File not found: ${args.path}` };
      return content;
    }
    if (name === 'write_file') {
      if (typeof args.path !== 'string' || typeof args.content !== 'string') {
        return { error: 'write_file requires path and content as strings' };
      }
      state.ai.staged.set(args.path, args.content);
      return { staged: args.path, bytes: args.content.length };
    }
    return { error: `unknown tool: ${name}` };
  }

  // ═══════════════════════════════════════════════════════════════
  // Small helpers
  // ═══════════════════════════════════════════════════════════════
  function whoHtml() {
    if (!auth.isAuthed() || !state.user) {
      return `<div class="who">Not signed in · <button style="background:transparent;border:none;color:#0366d6;cursor:pointer;padding:0;font-size:12px;" data-action="sign-in">Sign in with GitHub</button></div>`;
    }
    return `
      <div class="who">
        <img src="${esc(state.user.avatar_url)}" alt="" />
        <span>Signed in as <strong>${esc(state.user.login)}</strong></span>
        <button style="background:transparent;border:none;color:#0366d6;cursor:pointer;padding:0 0 0 8px;font-size:11px;margin-left:auto;" data-action="goto-settings">Settings</button>
      </div>
    `;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function slugify(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    });
  }
  async function safe(fn) { try { return await fn(); } catch (err) { log('safe caught', err); return null; } }
  function relativeTime(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  // ═══════════════════════════════════════════════════════════════
  // Cross-component events
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('oss-kanban:preview:change', () => {
    if (state.open) renderPanel();
  });
  window.addEventListener('oss-kanban:auth:change', () => {
    if (state.open) renderPanel();
  });
  // Preview-mode inside an iframe reports the iframe's own location. That
  // location is a raw.githack URL containing the owner/repo/branch prefix —
  // we only want the SITE-relative portion (e.g. `/about` or `index.html`).
  window.addEventListener('chorus:preview:location', (e) => {
    const href = e.detail?.href; if (!href) return;
    const sitePath = sitePathFromRawGithack(href);
    if (sitePath == null) return;
    if (sitePath !== state.currentPath) {
      state.currentPath = sitePath;
      if (state.open) renderPanel();
    }
  });

  // Given a full raw.githack URL, return just the site-relative path+query+hash.
  // Handles both raw.githack.com/owner/repo/BRANCH/path and
  // rawcdn.githack.com/owner/repo/SHA/path. Strips any `t=` cache-buster.
  function sitePathFromRawGithack(href) {
    try {
      const url = new URL(href);
      if (!url.hostname.endsWith('githack.com')) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 3) return null;

      // If the third segment looks like a full/short Git SHA, consume exactly
      // one segment for the ref. Otherwise match against the known branch
      // (branch names can contain slashes — e.g. `feature/foo` — so a flat
      // "drop 3 segments" rule would mis-parse those).
      const refLike = parts[2] || '';
      const isSha = /^[0-9a-f]{7,40}$/i.test(refLike);
      let consumed;
      if (isSha) {
        consumed = 3;
      } else {
        const known = state.currentBranch || state.featureBranch;
        if (known) {
          const knownSegs = known.split('/');
          const match = knownSegs.every((s, i) => parts[2 + i] === s);
          consumed = 2 + (match ? knownSegs.length : 1);
        } else {
          consumed = 3;
        }
      }
      const sitePathSegs = parts.slice(consumed);
      let sitePath = sitePathSegs.join('/') || 'index.html';

      // Drop our own cache-buster; keep everything else a real site might use.
      const search = new URLSearchParams(url.search);
      search.delete('t');
      const searchStr = search.toString();
      sitePath += (searchStr ? '?' + searchStr : '') + (url.hash || '');
      return sitePath;
    } catch {
      return null;
    }
  }

  // Messages from widgets inside preview iframes
  window.addEventListener('message', (e) => {
    const iframe = document.getElementById('oss-kanban-preview-iframe');
    if (!iframe || e.source !== iframe.contentWindow) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'chorus:preview:location') {
      window.dispatchEvent(new CustomEvent('chorus:preview:location', { detail: d }));
    }
    if (d.type === 'chorus:preview:capture') {
      state.capture = d.capture || null;
      state.pickMode = false;
      openPanel();
    }
    if (d.type === 'chorus:preview:cancelled') {
      state.pickMode = false;
      openPanel();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Init: fetch branches once on boot (for Browse screen)
  // ═══════════════════════════════════════════════════════════════
  fetchBranches();

  // Auto-open the preview iframe on boot (opt-in via data-auto-preview="true").
  // Gated on !inIframe so the chorus running inside the preview iframe
  // doesn't recursively open another iframe — which would open another, etc.
  // Only the top-level chorus auto-previews.
  if (AUTO_PREVIEW && !inIframe) {
    showBranchPreview(state.currentBranch);
  }

  log('loaded', { clientId: CLIENT_ID ? '(set)' : '(missing)', repo: REPO, proxy: AUTH_PROXY });

  if (DEBUG) {
    window.__chorusDebug = {
      state, root, trigger,
      openPanel, closePanel, navigate, goBack,
      fetchBranches, selectBranch, loadFeature,
      startDeviceFlow, cancelDeviceFlow, signOut,
      submitTicket, beginFirstAiTurn, continueAi,
      enterPickMode, exitPickMode,
    };
  }
}
