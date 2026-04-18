// OSS Kanban widget — module entry. Loaded as:
//   <script type="module" src="https://…/widget.js"
//           id="oss-kanban-widget"
//           data-github-client-id="..."
//           data-github-repo="owner/name"
//           data-github-auth-proxy="https://…"></script>
//
// Does three things:
//   1. File an issue from the current page (with element annotation)
//   2. Optionally run an AI session that edits the target repo
//   3. Surface the resulting branch so the user can preview it

import * as gh from './gh-client.js';
import { runSession as runAiSession } from './ai-client.js';
import * as preview from '../shared/preview.js';
import * as auth from '../shared/auth.js';

// Styles (declared before boot so the const is initialised by the time boot runs)
const CSS_TEXT = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
  .fab {
    position: fixed; bottom: 20px; right: 20px;
    width: 48px; height: 48px; border-radius: 24px;
    border: none; background: #111; color: white;
    font-size: 22px; cursor: pointer; pointer-events: auto;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s ease;
  }
  .fab:hover { transform: scale(1.05); }
  .fab.active { background: #c33; }
  .panel {
    position: fixed; bottom: 80px; right: 20px;
    width: 380px; max-height: 78vh; overflow: auto;
    background: white; color: #111;
    border-radius: 8px; border: 1px solid #e0e0e0;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    padding: 14px; pointer-events: auto;
    display: flex; flex-direction: column; gap: 10px;
  }
  .panel h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .panel .repo { font-size: 11px; color: #888; font-family: ui-monospace, monospace; }
  .panel label { font-size: 12px; color: #444; display: flex; flex-direction: column; gap: 4px; }
  .panel textarea, .panel input[type="password"] {
    font: inherit; font-size: 13px;
    padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px;
    resize: vertical;
  }
  .panel textarea { min-height: 60px; }
  .panel button {
    font: inherit; font-size: 13px; padding: 6px 12px;
    border: 1px solid #ccc; background: white; border-radius: 4px;
    cursor: pointer;
  }
  .panel button.primary { background: #111; color: white; border-color: #111; }
  .panel button.primary:disabled { background: #aaa; border-color: #aaa; cursor: default; }
  .panel button.github { background: #24292f; color: white; border-color: #24292f; }
  .panel button.linkish {
    background: transparent; border: none; color: #0366d6;
    padding: 2px 4px; font-size: 11px; margin-left: auto; cursor: pointer;
  }
  .panel .row { display: flex; gap: 8px; justify-content: space-between; align-items: center; }
  .panel .r-end { justify-content: flex-end; }
  .panel .row-r { display: flex; gap: 8px; }
  .panel .muted { font-size: 13px; color: #444; margin: 0; }
  .panel .muted-s { font-size: 12px; color: #666; }
  .panel .capture {
    padding: 8px; background: #f5f5f5; border-radius: 4px;
    font-size: 12px; font-family: ui-monospace, monospace;
    color: #333; word-break: break-all;
    max-height: 80px; overflow: auto;
  }
  .panel .capture.empty { color: #888; font-style: italic; }
  .panel .err {
    padding: 8px; background: #fff0f0; border: 1px solid #f0c0c0;
    border-radius: 4px; font-size: 12px; color: #a00;
  }
  .panel .err-inline { color: #a00; }
  .panel .ok {
    padding: 8px; background: #f0fff0; border: 1px solid #c0e0c0;
    border-radius: 4px; font-size: 12px; color: #060;
  }
  .panel .code {
    font-family: ui-monospace, monospace; font-size: 18px; font-weight: 600;
    padding: 10px; background: #111; color: white; border-radius: 4px;
    text-align: center; letter-spacing: 2px; user-select: all;
  }
  .panel .who {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: #555;
  }
  .panel .who img { width: 18px; height: 18px; border-radius: 9px; }
  .panel a { color: #0366d6; }
  .panel .log {
    font-family: ui-monospace, monospace; font-size: 12px;
    max-height: 240px; overflow: auto;
    padding: 8px; background: #fafafa; border: 1px solid #eee; border-radius: 4px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .panel .log-line { white-space: pre-wrap; word-break: break-word; }
  .panel .log-line.muted { color: #888; }
  .overlay {
    position: fixed; pointer-events: none;
    border: 2px solid #c33; background: rgba(204, 51, 51, 0.08);
    z-index: 2147483645; transition: all 0.05s linear;
  }
  .hint {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: #111; color: white; padding: 6px 12px; border-radius: 4px;
    font-size: 12px; pointer-events: none;
  }
`;

if (window.__ossKanbanWidgetLoaded) {
  // already loaded
} else {
  window.__ossKanbanWidgetLoaded = true;
  try {
    boot();
  } catch (err) {
    console.error('[kanban] boot failed:', err);
  }
}

function boot() {
  // ============================================================
  // Config from data-* attributes on the script tag
  // ============================================================
  const script =
    document.getElementById('oss-kanban-widget') ||
    document.querySelector('script[data-github-client-id]');

  const CLIENT_ID   = script?.dataset?.githubClientId || '';
  const REPO        = script?.dataset?.githubRepo || '';
  const AUTH_PROXY  = script?.dataset?.githubAuthProxy || '';
  const DEBUG       = script?.dataset?.debug === 'true';
  const DEFAULT_MODEL = script?.dataset?.openaiModel || 'gpt-4o';
  // `workflow` is needed so maintainers can install/update Action YAML files
  // via the switcher's one-click setup. Regular users still get by without it
  // (all other ops only need public_repo) but GitHub requires we declare it
  // up-front in the token request.
  const SCOPES = 'public_repo workflow';

  const DEVICE_CODE_URL = AUTH_PROXY ? `${AUTH_PROXY}/device/code` : 'https://github.com/login/device/code';
  const OAUTH_TOKEN_URL = AUTH_PROXY ? `${AUTH_PROXY}/oauth/token` : 'https://github.com/login/oauth/access_token';

  const log = (...a) => { if (DEBUG) console.log('[kanban]', ...a); };

  const configMissing = () => {
    const m = [];
    if (!CLIENT_ID) m.push('data-github-client-id');
    if (!REPO) m.push('data-github-repo');
    return m;
  };

  const [OWNER, REPONAME] = REPO.split('/');

  // ============================================================
  // State
  // ============================================================
  const state = {
    panelOpen: false,
    pickMode: false,
    name: '',
    description: '',
    capture: null,

    auth: 'idle',           // idle | device-pending | authed | error
    authError: null,
    token: null,
    user: null,
    deviceFlow: null,

    submitting: false,
    lastIssue: null,        // { html_url, number }

    // AI session
    openaiKey: null,
    view: 'ticket',         // ticket | ai-key | ai-running | ai-done | ai-error
    ai: null,               // { issueNumber, status, events: [], staged: Map, summary, branch, previewUrl, error }
  };

  // ============================================================
  // Shadow DOM + styles
  // ============================================================
  const host = document.createElement('div');
  host.id = 'oss-kanban-widget-host';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  root.appendChild(style);

  // ============================================================
  // FAB
  // ============================================================
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '+';
  fab.setAttribute('aria-label', 'Open feedback widget');
  fab.addEventListener('click', () => {
    if (state.pickMode) return exitPickMode();
    state.panelOpen ? closePanel() : openPanel();
  });
  root.appendChild(fab);

  // ============================================================
  // Panel orchestration
  // ============================================================
  let panelEl = null;

  function openPanel() { state.panelOpen = true; renderPanel(); }
  function closePanel() {
    state.panelOpen = false;
    panelEl?.remove();
    panelEl = null;
  }

  function renderPanel() {
    if (!state.panelOpen) return;
    panelEl?.remove();
    panelEl = document.createElement('div');
    panelEl.className = 'panel';

    const missing = configMissing();
    if (missing.length) {
      panelEl.innerHTML = `
        <div class="row"><h2>Propose a change</h2></div>
        <div class="err">Widget not configured. Missing: ${missing.join(', ')} on the &lt;script&gt; tag.</div>
        <div class="row r-end"><button data-action="close">Close</button></div>
      `;
      root.appendChild(panelEl);
      on('[data-action="close"]', 'click', closePanel);
      return;
    }

    const body =
      state.view === 'ai-key'     ? aiKeyHtml() :
      state.view === 'ai-running' ? aiRunningHtml() :
      state.view === 'ai-done'    ? aiDoneHtml() :
      state.view === 'ai-error'   ? aiErrorHtml() :
      state.auth === 'authed'         ? ticketFormHtml() :
      state.auth === 'device-pending' ? devicePendingHtml() :
                                         signInHtml();

    panelEl.innerHTML = `
      <div class="row">
        <h2>${panelTitle()}</h2>
        <span class="repo">${esc(REPO)}</span>
      </div>
      ${whoHtml()}
      ${body}
      ${state.authError ? `<div class="err">${esc(state.authError)}</div>` : ''}
    `;
    root.appendChild(panelEl);
    wirePanel();
  }

  function panelTitle() {
    if (state.view === 'ai-key')     return 'Start AI build';
    if (state.view === 'ai-running') return 'AI is working…';
    if (state.view === 'ai-done')    return 'Branch ready';
    if (state.view === 'ai-error')   return 'AI run failed';
    return 'Propose a change';
  }

  function whoHtml() {
    if (state.auth !== 'authed' || !state.user) return '';
    return `
      <div class="who">
        <img src="${esc(state.user.avatar_url)}" alt="" />
        <span>Signed in as <strong>${esc(state.user.login)}</strong></span>
        <button data-action="sign-out" class="linkish">Sign out</button>
      </div>
    `;
  }

  function signInHtml() {
    return `
      <p class="muted">Sign in with GitHub to file tickets. Your token is kept in memory only for this browser session.</p>
      <div class="row r-end"><button class="github" data-action="sign-in">Sign in with GitHub</button></div>
    `;
  }

  function devicePendingHtml() {
    const df = state.deviceFlow;
    if (!df) return '';
    return `
      <p class="muted">
        Open <a href="${esc(df.verificationUri)}" target="_blank" rel="noopener">${esc(df.verificationUri)}</a>
        and enter this code:
      </p>
      <div class="code">${esc(df.userCode)}</div>
      <div class="muted-s">Waiting for authorisation…</div>
      <div class="row r-end"><button data-action="cancel-auth">Cancel</button></div>
    `;
  }

  function ticketFormHtml() {
    const capture = state.capture;
    const captureClass = capture ? 'capture' : 'capture empty';
    const captureText = capture
      ? `<${capture.tag}> ${capture.selector}${capture.text ? ` — "${capture.text.slice(0, 60)}"` : ''}`
      : 'nothing selected';
    const hasAll = state.name.trim() && state.description.trim();
    const submitDisabled = !hasAll || state.submitting ? 'disabled' : '';
    const submitLabel = state.submitting ? 'Filing…' : 'File issue';
    const filed = state.lastIssue;
    const slugPreview = slugify(state.name);
    return `
      <label>
        Feature name <span class="muted-s" style="font-weight:normal">(becomes the branch)</span>
        <input type="text" data-field="name" value="${esc(state.name)}" placeholder="e.g. redesign-hero" />
      </label>
      ${slugPreview ? `<div class="muted-s">Branch: <code>feature/${esc(slugPreview)}</code></div>` : ''}
      <label>
        What would you like changed?
        <textarea data-field="description" placeholder="e.g. Make the hero heading bigger">${esc(state.description)}</textarea>
      </label>
      <div>
        <div class="muted-s">Selected element</div>
        <div class="${captureClass}">${esc(captureText)}</div>
      </div>
      <div class="row">
        <button data-action="pick">Pick element</button>
        <div class="row-r">
          <button data-action="close">Close</button>
          <button class="primary" data-action="submit" ${submitDisabled}>${submitLabel}</button>
        </div>
      </div>
      ${filed ? `
        <div class="ok">
          Filed · <a href="${esc(filed.html_url)}" target="_blank" rel="noopener">#${filed.number}</a>
        </div>
        <div class="row r-end">
          <button class="primary" data-action="ai-start">Build with AI</button>
        </div>
      ` : ''}
    `;
  }

  function aiKeyHtml() {
    return `
      <p class="muted">Paste your OpenAI API key. It is kept in memory only, used only for this session, and sent directly from your browser to OpenAI.</p>
      <label>
        OpenAI API key
        <input type="password" data-field="openai-key" placeholder="sk-…" autocomplete="off" />
      </label>
      <p class="muted-s">Use a key scoped to a low spend cap. This tool does not enforce a budget.</p>
      <div class="row r-end">
        <button data-action="ai-cancel">Cancel</button>
        <button class="primary" data-action="ai-go">Start build</button>
      </div>
    `;
  }

  function aiRunningHtml() {
    const events = state.ai?.events || [];
    return `
      <div class="muted-s">Issue #${state.ai?.issueNumber} · model <code>${esc(DEFAULT_MODEL)}</code></div>
      <div class="log">
        ${events.map(renderEvent).join('')}
        ${state.ai?.status === 'committing' ? '<div class="log-line">⏳ Committing…</div>' : ''}
      </div>
      <div class="row r-end"><button data-action="ai-abort">Cancel</button></div>
    `;
  }

  function aiDoneHtml() {
    const s = state.ai;
    const previewing = preview.isShowing();
    const turns = s.turn || 1;
    return `
      <div class="ok">Branch <code>${esc(s.branch)}</code> · turn ${turns}</div>
      ${s.summary ? `<div class="muted-s">${esc(s.summary)}</div>` : ''}
      <div class="log">${(s.events || []).map(renderEvent).join('')}</div>
      <label>
        Refine — what should the AI change next?
        <textarea data-field="followup" placeholder="e.g. make the heading bolder · add a subheading · revert the colour">${esc(s.followUpDraft || '')}</textarea>
      </label>
      <div class="row">
        <div class="row-r">
          <button data-action="ai-reset">New ticket</button>
          <button data-action="ai-open-newtab">New tab</button>
          ${previewing
            ? `<button data-action="ai-close-preview">Hide preview</button>`
            : `<button data-action="ai-show-preview">Show preview</button>`}
        </div>
        <button class="primary" data-action="ai-continue" ${(s.followUpDraft || '').trim() ? '' : 'disabled'}>Continue</button>
      </div>
    `;
  }

  function aiErrorHtml() {
    const s = state.ai;
    return `
      <div class="err">${esc(s?.error || 'Unknown error')}</div>
      <div class="log">${(s?.events || []).map(renderEvent).join('')}</div>
      <div class="row r-end">
        <button data-action="ai-reset">Back</button>
      </div>
    `;
  }

  function renderEvent(e) {
    if (e.type === 'thinking')       return `<div class="log-line muted">→ thinking… (${e.iteration + 1})</div>`;
    if (e.type === 'tool_call')      return `<div class="log-line">→ <strong>${esc(e.name)}</strong>(${esc(shortArgs(e.args))})</div>`;
    if (e.type === 'tool_result')    return `<div class="log-line muted">  ← ${esc(JSON.stringify(e.result))}</div>`;
    if (e.type === 'tool_error')     return `<div class="log-line err-inline">  ← error: ${esc(e.error)}</div>`;
    if (e.type === 'finish')         return `<div class="log-line">✓ finish — ${esc(e.summary)}</div>`;
    if (e.type === 'assistant_text' && e.text) return `<div class="log-line muted">“${esc(e.text.slice(0, 200))}${e.text.length > 200 ? '…' : ''}”</div>`;
    if (e.type === 'iteration_limit') return `<div class="log-line err-inline">⚠ hit iteration limit</div>`;
    if (e.type === 'stopped_without_finish') return `<div class="log-line err-inline">⚠ stopped without calling finish</div>`;
    return '';
  }

  function shortArgs(args) {
    const s = JSON.stringify(args || {});
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  }

  // ============================================================
  // Panel wiring
  // ============================================================
  function on(sel, ev, fn) { panelEl?.querySelector(sel)?.addEventListener(ev, fn); }

  function wirePanel() {
    if (!panelEl) return;
    on('[data-action="close"]',       'click', closePanel);
    on('[data-action="sign-in"]',     'click', startDeviceFlow);
    on('[data-action="sign-out"]',    'click', signOut);
    on('[data-action="cancel-auth"]', 'click', cancelDeviceFlow);
    on('[data-action="pick"]',        'click', enterPickMode);
    on('[data-action="submit"]',      'click', submitTicket);

    on('[data-action="ai-start"]',         'click', startAi);
    on('[data-action="ai-go"]',            'click', aiGo);
    on('[data-action="ai-cancel"]',        'click', aiCancel);
    on('[data-action="ai-abort"]',         'click', aiAbort);
    on('[data-action="ai-reset"]',         'click', aiReset);
    on('[data-action="ai-show-preview"]',  'click', showPreview);
    on('[data-action="ai-close-preview"]', 'click', hidePreview);
    on('[data-action="ai-open-newtab"]',   'click', openPreviewInNewTab);
    on('[data-action="ai-continue"]',      'click', continueAi);

    const followup = panelEl.querySelector('[data-field="followup"]');
    followup?.addEventListener('input', (e) => {
      if (state.ai) state.ai.followUpDraft = e.target.value;
      const btn = panelEl.querySelector('[data-action="ai-continue"]');
      if (btn) btn.disabled = !e.target.value.trim();
    });

    const desc = panelEl.querySelector('[data-field="description"]');
    desc?.addEventListener('input', (e) => {
      state.description = e.target.value;
      updateTicketSubmit();
    });
    const nameInput = panelEl.querySelector('[data-field="name"]');
    nameInput?.addEventListener('input', (e) => {
      state.name = e.target.value;
      // Re-render so the slug preview updates.
      renderPanel();
      // Refocus the input the user is typing in (renderPanel rebuilds DOM).
      const nn = panelEl?.querySelector('[data-field="name"]');
      if (nn) {
        nn.focus();
        // Cursor to end
        const len = nn.value.length;
        nn.setSelectionRange(len, len);
      }
    });
    function updateTicketSubmit() {
      const btn = panelEl?.querySelector('[data-action="submit"]');
      if (btn) btn.disabled = !state.name.trim() || !state.description.trim() || state.submitting;
    }

    const key = panelEl.querySelector('[data-field="openai-key"]');
    if (key && state.openaiKey) key.value = state.openaiKey;
  }

  // ============================================================
  // Element picker (unchanged)
  // ============================================================
  let overlayEl = null;
  let hintEl = null;

  function enterPickMode() {
    if (state.pickMode) return;
    state.pickMode = true;
    fab.classList.add('active');
    fab.textContent = '×';
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
    state.pickMode = false;
    fab.classList.remove('active');
    fab.textContent = '+';
    overlayEl?.remove(); overlayEl = null;
    hintEl?.remove(); hintEl = null;
    document.removeEventListener('mousemove', onPickHover, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
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
    captureTarget(e.target);
    exitPickMode();
    openPanel();
  }

  function onPickKey(e) {
    if (e.key === 'Escape') { exitPickMode(); openPanel(); }
  }

  function isOurs(el) { return host.contains(el) || el === host; }

  function captureTarget(el) {
    const r = el.getBoundingClientRect();
    state.capture = {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      text: (el.innerText || '').trim().slice(0, 200),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      url: location.href,
    };
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
      parts.unshift(seg);
      if (parent && parent.id) { parts.unshift('#' + CSS.escape(parent.id)); break; }
      cur = parent;
    }
    return parts.join(' > ');
  }

  // ============================================================
  // GitHub device-flow auth
  // ============================================================
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
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        interval: (data.interval || 5) * 1000,
        expiresAt: Date.now() + (data.expires_in || 900) * 1000,
      };
      state.auth = 'device-pending';
      renderPanel();
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
          renderPanel();
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
    state.authError = 'GitHub auth code expired. Try again.';
    state.deviceFlow = null;
    renderPanel();
  }

  function cancelDeviceFlow() {
    devicePollAbort?.abort();
    devicePollAbort = null;
    state.auth = 'idle';
    state.deviceFlow = null;
    renderPanel();
  }

  function signOut() {
    state.token = null;
    state.user = null;
    state.auth = 'idle';
    state.authError = null;
    state.lastIssue = null;
    auth.clearAuth();
    renderPanel();
  }

  // ============================================================
  // Submit a ticket
  // ============================================================
  async function submitTicket() {
    if (state.auth !== 'authed' || !state.token) return;
    state.submitting = true; state.authError = null; renderPanel();
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
      state.lastIssue = { html_url: issue.html_url, number: issue.number };
      window.dispatchEvent(new CustomEvent('oss-kanban:ticket', { detail: state.lastIssue }));
    } catch (err) {
      state.authError = `Could not file issue: ${err.message || err}`;
    } finally {
      state.submitting = false;
      renderPanel();
    }
  }

  // ============================================================
  // AI session
  // ============================================================
  let aiAbortController = null;

  function showPreview() {
    const url = state.ai?.previewUrl;
    if (!url) return;
    preview.show(url);
  }

  function hidePreview() {
    preview.hide();
  }

  function openPreviewInNewTab() {
    if (state.ai?.previewUrl) window.open(state.ai.previewUrl, '_blank', 'noopener');
  }

  // Re-render the panel whenever preview visibility changes anywhere on the page.
  window.addEventListener('oss-kanban:preview:change', () => {
    if (state.panelOpen) renderPanel();
  });

  function startAi() {
    if (!state.openaiKey) {
      state.view = 'ai-key';
    } else {
      beginAiRun();
    }
    renderPanel();
  }

  function aiGo() {
    const input = panelEl.querySelector('[data-field="openai-key"]');
    const key = input?.value?.trim();
    if (!key) return;
    state.openaiKey = key;
    beginAiRun();
  }

  function aiCancel() {
    state.view = 'ticket';
    renderPanel();
  }

  function aiAbort() {
    aiAbortController?.abort();
  }

  function aiReset() {
    hidePreview();
    state.ai = null;
    state.view = 'ticket';
    state.name = '';
    state.description = '';
    state.capture = null;
    state.lastIssue = null;
    renderPanel();
  }


  async function beginAiRun() {
    const issue = state.lastIssue;
    if (!issue) return;

    state.view = 'ai-running';
    state.ai = {
      issueNumber: issue.number,
      status: 'running',
      events: [],
      staged: new Map(),
      messages: null,       // openai conversation history carried across turns
      turn: 1,
      summary: null,
      branch: null,
      workingRef: null,     // ref for reads — starts as default branch, becomes the AI branch after first commit
      previewUrl: null,
      followUpDraft: '',
      error: null,
    };
    renderPanel();

    aiAbortController = new AbortController();
    const repoMeta = await safe(() => gh.getRepo(state.token, OWNER, REPONAME));
    if (!repoMeta) return aiFail('Could not read repository metadata.');
    const defaultBranch = repoMeta.default_branch || 'main';
    state.ai.workingRef = defaultBranch;

    const userPrompt = buildUserPrompt(issue, state.description, state.capture, defaultBranch);

    try {
      const result = await runAiSession({
        apiKey: state.openaiKey,
        model: DEFAULT_MODEL,
        userPrompt,
        signal: aiAbortController.signal,
        onEvent: pushAiEvent,
        executeTool: (name, args) => executeTool(name, args),
      });
      await commitAndSurface(result, issue, /* firstTurn */ true, defaultBranch);
    } catch (err) {
      if (aiAbortController.signal.aborted) return aiFail('Cancelled.');
      aiFail(err.message || String(err));
    }
  }

  async function continueAi() {
    if (!state.ai?.branch || !state.ai.messages) return;
    const followUp = (state.ai.followUpDraft || '').trim();
    if (!followUp) return;

    // Reset per-turn scratch state; keep conversation history + branch.
    state.ai.events = [];
    state.ai.staged = new Map();
    state.ai.status = 'running';
    state.ai.turn = (state.ai.turn || 1) + 1;
    state.ai.error = null;
    state.view = 'ai-running';
    renderPanel();

    aiAbortController = new AbortController();
    try {
      const result = await runAiSession({
        apiKey: state.openaiKey,
        model: DEFAULT_MODEL,
        priorMessages: state.ai.messages,
        followUp,
        signal: aiAbortController.signal,
        onEvent: pushAiEvent,
        executeTool: (name, args) => executeTool(name, args),
      });
      await commitAndSurface(result, state.lastIssue, /* firstTurn */ false, null);
      state.ai.followUpDraft = '';
    } catch (err) {
      if (aiAbortController.signal.aborted) return aiFail('Cancelled.');
      aiFail(err.message || String(err));
    }
  }

  async function commitAndSurface(result, issue, firstTurn, defaultBranch) {
    // Persist conversation even if no writes this turn.
    state.ai.messages = result.messages;

    if (!state.ai.staged.size) {
      state.ai.status = 'done';
      state.ai.summary = result.summary || '(no changes this turn)';
      state.view = 'ai-done';
      renderPanel();
      return;
    }

    state.ai.status = 'committing';
    renderPanel();

    const branch = firstTurn
      ? `feature/${slugify(state.name) || 'issue-' + issue.number}`
      : state.ai.branch;

    const commitMessage = result.summary
      ? `${result.summary}\n\nRefs #${issue.number}`
      : `AI edits for #${issue.number} (turn ${state.ai.turn})`;

    await gh.commitFiles(state.token, OWNER, REPONAME, {
      branch,
      startFrom: firstTurn ? defaultBranch : undefined,
      message: commitMessage,
      files: state.ai.staged,
    });

    const previewUrl = `https://raw.githack.com/${OWNER}/${REPONAME}/${branch}/index.html`;

    await safe(() => gh.createIssueComment(
      state.token, OWNER, REPONAME, issue.number,
      firstTurn
        ? `AI built a candidate on branch \`${branch}\`.\n\nPreview: ${previewUrl}${result.summary ? '\n\nSummary: ' + result.summary : ''}`
        : `Turn ${state.ai.turn} on \`${branch}\`${result.summary ? ': ' + result.summary : ''}`
    ));

    state.ai.branch = branch;
    state.ai.workingRef = branch;  // tool reads next turn see the AI's own work
    state.ai.previewUrl = previewUrl;
    state.ai.summary = result.summary;
    state.ai.status = 'done';
    state.view = 'ai-done';

    if (firstTurn) {
      showPreview();
    } else if (preview.isShowing()) {
      preview.reload();
    }

    renderPanel();
  }

  function aiFail(msg) {
    if (state.ai) {
      state.ai.error = msg;
      state.ai.status = 'error';
    } else {
      state.ai = { error: msg, status: 'error', events: [] };
    }
    state.view = 'ai-error';
    renderPanel();
  }

  function pushAiEvent(ev) {
    if (!state.ai) return;
    state.ai.events.push(ev);
    // In running view, re-render so the log updates.
    if (state.view === 'ai-running') renderPanel();
    log('ai event', ev);
  }

  function buildUserPrompt(issue, description, capture, defaultBranch) {
    return [
      `Feature: ${state.name}`,
      `Ticket: ${description.trim()}`,
      '',
      `Issue number: ${issue.number}`,
      `Working branch: feature/${slugify(state.name)}`,
      `Repo default branch: ${defaultBranch}`,
      capture ? `Annotated element: ${JSON.stringify(capture, null, 2)}` : 'No element annotation.',
      '',
      'Use list_files first to see what is in the repo. Read relevant files, then stage changes with write_file, then call finish.',
    ].join('\n');
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  // ---- tool dispatch ----
  async function executeTool(name, args) {
    const workingRef = state.ai?.workingRef || 'main';
    if (name === 'list_files') {
      const ref = args.ref || workingRef;
      const tree = await gh.listTree(state.token, OWNER, REPONAME, ref);
      return (tree.tree || [])
        .filter((e) => e.type === 'blob')
        .map((e) => ({ path: e.path, size: e.size ?? 0 }));
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

  // ============================================================
  // Helpers
  // ============================================================
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    });
  }

  async function safe(fn) {
    try { return await fn(); } catch (err) { log('safe caught', err); return null; }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============================================================
  // Debug hook
  // ============================================================
  log('loaded', { clientId: CLIENT_ID ? '(set)' : '(missing)', repo: REPO, proxy: AUTH_PROXY });

  if (DEBUG) {
    window.__ossKanbanDebug = {
      state, root, fab,
      openPanel, closePanel, renderPanel,
      enterPickMode, exitPickMode, captureTarget,
      startDeviceFlow, cancelDeviceFlow, signOut,
      submitTicket, startAi, beginAiRun,
    };
  }
}

// (CSS_TEXT is declared at the top of this module, before boot().)
