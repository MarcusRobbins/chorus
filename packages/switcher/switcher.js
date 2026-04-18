// Branch switcher — top-left panel. Two views: list (browse branches) and
// detail (discussion, votes, merge for one branch). Separate from the widget:
// the widget is "what am I doing now," the switcher is "where am I in the
// project's history, and what does the community think?"

import * as preview from '../shared/preview.js';
import * as auth from '../shared/auth.js';
import * as gh from '../widget/gh-client.js';

// Files installed when the maintainer clicks "Install workflow". All three
// are committed in one atomic commit via the Git Data API.
//
// The file contents live canonically in packages/governance/ so they can be
// versioned / tested / dogfooded from one place; we fetch them at install
// time (relative to this module's URL, which works on localhost and on
// jsDelivr).
const WORKFLOW_PATH = '.github/workflows/osskanban.yml';
const GOVERNANCE_PATH = '.github/scripts/governance.mjs';
const RULES_PATH = '.github/scripts/rules.mjs';

async function loadWorkflowFiles() {
  const base = new URL('../governance/', import.meta.url);
  const urls = {
    yaml: new URL('workflow.yml', base),
    governance: new URL('governance.mjs', base),
    rules: new URL('rules.mjs', base),
  };
  const [yaml, governance, rules] = await Promise.all([
    fetch(urls.yaml).then((r) => {
      if (!r.ok) throw new Error(`workflow.yml ${r.status}`);
      return r.text();
    }),
    fetch(urls.governance).then((r) => {
      if (!r.ok) throw new Error(`governance.mjs ${r.status}`);
      return r.text();
    }),
    fetch(urls.rules).then((r) => {
      if (!r.ok) throw new Error(`rules.mjs ${r.status}`);
      return r.text();
    }),
  ]);
  return { yaml, governance, rules };
}

// Declared before boot() to avoid TDZ when CSS is read during setup.
const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
  .trigger {
    background: white; color: #111;
    padding: 6px 12px; border-radius: 16px;
    border: 1px solid #ccc;
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    font-size: 13px; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .trigger:hover { background: #f5f5f5; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #ccc; }
  .dot.live { background: #4a4; }
  .muted { color: #888; }
  .muted-s { color: #888; font-size: 12px; }
  strong { font-family: ui-monospace, monospace; font-weight: 600; }
  .panel {
    margin-top: 6px;
    background: white; color: #111;
    border-radius: 8px; border: 1px solid #e0e0e0;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    padding: 10px;
    max-height: 80vh; overflow: auto;
    font-size: 13px;
  }
  .panel.list { min-width: 280px; max-width: 380px; }
  .panel.detail { min-width: 420px; max-width: 520px; }
  .hdr {
    display: flex; justify-content: space-between; align-items: center;
    gap: 8px; margin-bottom: 8px;
  }
  .repo {
    font-family: ui-monospace, monospace; font-size: 12px; color: #555;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .toolbar { display: flex; gap: 4px; flex-shrink: 0; }
  .toolbar button {
    font: inherit; font-size: 11px; padding: 2px 8px;
    border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer;
  }
  .toolbar button.close-preview { background: #c33; color: white; border-color: #c33; }
  .err {
    padding: 6px 8px; background: #fff0f0; border: 1px solid #f0c0c0;
    border-radius: 4px; font-size: 12px; color: #a00; margin: 6px 0;
  }
  .ok {
    padding: 6px 8px; background: #f0fff0; border: 1px solid #c0e0c0;
    border-radius: 4px; font-size: 12px; color: #060; margin: 6px 0;
  }
  section { margin-top: 10px; }
  section:first-of-type { margin-top: 0; }
  section h4 {
    margin: 0 0 4px 0; font-size: 10px; text-transform: uppercase;
    color: #888; letter-spacing: 0.5px; font-weight: 600;
  }
  .auto-banner {
    padding: 8px 10px; margin: 6px 0;
    border-radius: 6px;
    font-size: 12px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .auto-banner.install-banner { background: #fff8e1; border: 1px solid #ffd77a; }
  .auto-banner.ok-banner { background: #f0fff0; border: 1px solid #c0e0c0; color: #060; }
  .auto-banner.err-banner { background: #fff0f0; border: 1px solid #f0c0c0; color: #a00; }
  .auto-banner .row-r { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
  .auto-banner code {
    font-family: ui-monospace, monospace; font-size: 11px;
    background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px;
  }
  .auto-banner a { color: #0366d6; text-decoration: underline; }
  .auto-banner button {
    font: inherit; font-size: 12px; padding: 4px 10px;
    border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer;
  }
  .auto-banner button.primary { background: #111; color: white; border-color: #111; }

  .path-row {
    display: flex; align-items: stretch; gap: 4px;
    margin: 8px 0; padding: 4px;
    background: #f5f5f5; border-radius: 4px;
  }
  .path-label {
    flex: 1; display: flex; align-items: center; gap: 6px;
    font-size: 12px; padding: 0 4px;
  }
  .path-label input {
    flex: 1;
    font: inherit; font-size: 12px; padding: 4px 6px;
    font-family: ui-monospace, monospace;
    border: 1px solid #ccc; border-radius: 3px;
    min-width: 0;
  }
  .apply-path {
    font: inherit; font-size: 12px; padding: 4px 10px;
    border: 1px solid #111; background: #111; color: white;
    border-radius: 3px; cursor: pointer; flex-shrink: 0;
  }
  .branch-list { display: flex; flex-direction: column; gap: 1px; }
  .branch-item {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px; border-radius: 4px; cursor: pointer;
    font-size: 12px;
  }
  .branch-item:hover { background: #f0f0f0; }
  .branch-item.selected { background: #e0f0ff; }
  .branch-item .name {
    font-family: ui-monospace, monospace; flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .branch-item .sha {
    font-family: ui-monospace, monospace; color: #888; font-size: 11px; flex-shrink: 0;
  }
  .back-btn {
    font: inherit; font-size: 12px; padding: 3px 8px;
    border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer;
  }
  .branch-title {
    font-family: ui-monospace, monospace; font-size: 13px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .detail-actions { display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap; }
  .detail-actions button {
    font: inherit; font-size: 12px; padding: 5px 10px;
    border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;
  }
  .detail-actions .primary { background: #2a6; color: white; border-color: #2a6; }
  .detail-actions .primary:disabled { background: #aaa; border-color: #aaa; cursor: default; }
  .issue {
    border: 1px solid #e0e0e0; border-radius: 6px;
    padding: 8px; margin-bottom: 8px; background: #fafafa;
  }
  .issue-hdr {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px;
  }
  .issue-num { color: #666; font-family: ui-monospace, monospace; font-size: 11px; }
  .issue-title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .issue-state {
    font-size: 10px; padding: 2px 6px; border-radius: 8px;
    text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
  }
  .issue-state.open { background: #e0ffe0; color: #060; }
  .issue-state.closed { background: #e0e0e0; color: #555; }
  .issue-body {
    font-size: 12px; color: #333; margin: 6px 0;
    max-height: 100px; overflow: auto;
    white-space: pre-wrap; word-break: break-word;
    background: white; padding: 6px; border-radius: 3px; border: 1px solid #eee;
  }
  .vote-row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
  .vote-btn {
    font: inherit; font-size: 12px; padding: 3px 9px;
    border: 1px solid #ccc; background: white; border-radius: 12px; cursor: pointer;
    display: inline-flex; gap: 4px; align-items: center;
  }
  .vote-btn:hover { background: #f0f0f0; }
  .vote-btn:disabled { opacity: 0.5; cursor: default; }
  .comments-toggle {
    background: transparent; border: none; color: #0366d6;
    font-size: 12px; cursor: pointer; padding: 2px;
  }
  .comments {
    margin-top: 6px; border-top: 1px solid #eee; padding-top: 6px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .comment {
    font-size: 12px; padding: 6px 8px;
    background: white; border: 1px solid #eee; border-radius: 4px;
  }
  .comment-hdr {
    display: flex; align-items: center; gap: 4px;
    font-size: 11px; color: #666; margin-bottom: 3px;
  }
  .comment-hdr img { width: 14px; height: 14px; border-radius: 7px; }
  .comment-body { white-space: pre-wrap; word-break: break-word; color: #222; }
  .compose { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .compose textarea {
    font: inherit; font-size: 12px; padding: 6px;
    border: 1px solid #ccc; border-radius: 3px; min-height: 40px; resize: vertical;
  }
  .compose .row { display: flex; justify-content: flex-end; gap: 4px; }
  .compose button {
    font: inherit; font-size: 12px; padding: 4px 10px;
    border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer;
  }
  .compose button.primary { background: #111; color: white; border-color: #111; }
  .sign-in-hint {
    font-size: 12px; color: #888; font-style: italic;
    padding: 6px 0;
  }
`;

if (window.__ossKanbanSwitcherLoaded) {
  // already loaded
} else {
  window.__ossKanbanSwitcherLoaded = true;
  try {
    boot();
  } catch (err) {
    console.error('[kanban-switcher] boot failed:', err);
  }
}

function boot() {
  const script =
    document.getElementById('oss-kanban-switcher') ||
    document.querySelector('script[src*="switcher.js"]');

  const REPO = script?.dataset?.githubRepo || '';
  const DEBUG = script?.dataset?.debug === 'true';

  if (!REPO) {
    console.warn('[kanban-switcher] data-github-repo not set; switcher disabled.');
    return;
  }

  const [OWNER, REPONAME] = REPO.split('/');
  const log = (...a) => { if (DEBUG) console.log('[kanban-switcher]', ...a); };

  // ----- state -----
  const state = {
    open: false,
    view: 'list',            // 'list' | 'detail'
    branches: [],
    loading: false,
    error: null,
    selected: null,          // branch currently shown in the preview overlay

    // "Place" — path within the site that we carry across branches.
    // Starts from the host URL's search + hash. User can edit it. Every
    // preview URL is constructed as `<branch-root>/<currentPath>`.
    currentPath: initialPath(),

    // detail-view state
    detailBranch: null,
    detailLoading: false,
    detailError: null,
    detailIssues: [],        // issues found to reference this branch
    detailComments: new Map(), // issue.number -> [comments]
    detailExpanded: new Set(), // issue.numbers whose comments are expanded
    detailComposeDraft: new Map(), // issue.number -> string
    mergeStatus: null,       // null | 'pending' | { ok: true, sha } | { error: '...' }

    // Automation (GitHub Action) install state.
    automation: {
      permission: 'unknown',  // 'yes' | 'no' | 'unknown' — push access on the repo
      status: 'unknown',      // 'unknown' | 'not-installed' | 'installing' | 'installed' | 'error'
      error: null,
      installedAt: null,      // Date once the workflow file appears, used for pollRun
    },
  };

  function initialPath() {
    // We land on the branch's repo root (e.g. index.html). Any query/hash from
    // the host travels with us. If someone's on /#/pricing on the live site
    // they see /#/pricing on any branch they switch to.
    return 'index.html' + (location.search || '') + (location.hash || '');
  }

  function previewUrlFor(branchName, path = state.currentPath) {
    const cleanPath = String(path || 'index.html').replace(/^\/+/, '');
    return `https://raw.githack.com/${OWNER}/${REPONAME}/${encodeURIComponent(branchName)}/${cleanPath}`;
  }

  // ----- automation install --------------------------------------------------
  async function refreshAutomationStatus() {
    const token = auth.getToken();
    if (!token) {
      state.automation = { permission: 'unknown', status: 'unknown', error: null, installedAt: null };
      if (state.open) renderPanel();
      return;
    }
    // Permission check: does this user have push access?
    try {
      const meta = await gh.getRepo(token, OWNER, REPONAME);
      state.automation.permission = (meta?.permissions?.push || meta?.permissions?.admin) ? 'yes' : 'no';
    } catch {
      state.automation.permission = 'unknown';
    }
    // File-existence check.
    try {
      const existing = await gh.readFile(token, OWNER, REPONAME, WORKFLOW_PATH);
      state.automation.status = existing === null ? 'not-installed' : 'installed';
    } catch (err) {
      state.automation.status = 'not-installed';
    }
    if (state.open) renderPanel();
  }

  async function installAutomation() {
    const token = auth.getToken();
    if (!token) return;
    state.automation.status = 'installing';
    state.automation.error = null;
    renderPanel();
    try {
      const files = await loadWorkflowFiles();
      // One atomic commit to main with all three files.
      await gh.commitFiles(token, OWNER, REPONAME, {
        branch: 'main',
        message: 'Install oss-kanban governance workflow',
        files: {
          [WORKFLOW_PATH]: files.yaml,
          [GOVERNANCE_PATH]: files.governance,
          [RULES_PATH]: files.rules,
        },
      });
      state.automation.status = 'installed';
      state.automation.installedAt = new Date();
    } catch (err) {
      const msg = String(err.message || err);
      state.automation.status = 'error';
      // The most likely error: pre-existing tokens without the newly-requested
      // `workflow` scope will 403. Also possible: branch protection rejecting
      // the direct push.
      if (msg.includes(' 403') && msg.toLowerCase().includes('workflow')) {
        state.automation.error =
          'Your sign-in token does not include the `workflow` scope. Sign out from the widget and sign in again.';
      } else if (msg.includes(' 422') || msg.toLowerCase().includes('protected')) {
        state.automation.error =
          'Could not push to main — branch protection may be blocking it. Install manually or relax branch protection for workflow paths.';
      } else {
        state.automation.error = msg;
      }
    }
    renderPanel();
  }

  // ----- shadow DOM -----
  const host = document.createElement('div');
  host.id = 'oss-kanban-switcher-host';
  host.style.cssText =
    'position: fixed; top: 16px; left: 16px; z-index: 2147483644; pointer-events: auto;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  // ----- trigger -----
  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  root.appendChild(trigger);
  trigger.addEventListener('click', () => {
    state.open ? closePanel() : openPanel();
  });

  // ----- panel -----
  let panelEl = null;

  function openPanel() {
    state.open = true;
    renderPanel();
    if (state.view === 'list' && !state.branches.length && !state.loading) fetchBranches();
  }
  function closePanel() {
    state.open = false;
    panelEl?.remove();
    panelEl = null;
  }

  function renderTrigger() {
    const sel = state.selected;
    const showing = preview.isShowing();
    if (sel && showing) {
      trigger.innerHTML = `<span class="dot live"></span> <strong>${esc(sel)}</strong> <span class="muted">▾</span>`;
    } else {
      trigger.innerHTML = `<span class="dot"></span> Branches <span class="muted">▾</span>`;
    }
  }

  function renderPanel() {
    if (!state.open) return;
    panelEl?.remove();
    panelEl = document.createElement('div');
    panelEl.className = `panel ${state.view}`;
    panelEl.innerHTML = state.view === 'detail' ? renderDetailHtml() : renderListHtml();
    root.appendChild(panelEl);
    wirePanel();
  }

  // ==================================================================
  // LIST VIEW
  // ==================================================================
  function renderListHtml() {
    const main = state.branches.find((b) => b.name === 'main' || b.name === 'master');
    const others = state.branches.filter((b) => b !== main);
    const features = others.filter((b) => b.name.startsWith('feature/'));
    const autos = others.filter((b) => b.name.startsWith('auto/'));
    const rest = others.filter(
      (b) => !b.name.startsWith('feature/') && !b.name.startsWith('auto/')
    );
    return `
      <div class="hdr">
        <div class="repo">${esc(REPO)}</div>
        <div class="toolbar">
          <button data-action="refresh" title="Refresh">↻</button>
          ${preview.isShowing() ? `<button data-action="close-preview" class="close-preview">Hide preview</button>` : ''}
        </div>
      </div>
      ${pathInputHtml()}
      ${automationBannerHtml()}
      ${state.error ? `<div class="err">${esc(state.error)}</div>` : ''}
      ${state.loading ? `<div class="muted-s">Loading…</div>` : ''}
      ${main ? `<section><h4>Default</h4><div class="branch-list">${branchItemHtml(main)}</div></section>` : ''}
      ${features.length
        ? `<section><h4>Features</h4><div class="branch-list">${features.map(branchItemHtml).join('')}</div></section>`
        : ''}
      ${autos.length
        ? `<section><h4>Other branches</h4><div class="branch-list">${autos.map(branchItemHtml).join('')}</div></section>`
        : ''}
      ${rest.length
        ? `<section><h4>Misc</h4><div class="branch-list">${rest.map(branchItemHtml).join('')}</div></section>`
        : ''}
      ${!state.loading && !state.branches.length && !state.error
        ? `<div class="muted-s">No branches found.</div>` : ''}
    `;
  }

  function branchItemHtml(b) {
    const sel = state.selected === b.name ? 'selected' : '';
    return `
      <div class="branch-item ${sel}" data-branch="${esc(b.name)}" title="${esc(b.name)}">
        <span class="name">${esc(b.name)}</span>
        <span class="sha">${esc((b.commit?.sha || '').slice(0, 7))}</span>
      </div>
    `;
  }

  // One-click install banner for the GitHub Action. Only rendered when the
  // signed-in user has push access AND the workflow isn't installed yet (or is
  // currently mid-install / errored).
  function automationBannerHtml() {
    const a = state.automation;

    // Only relevant to users who can actually install it
    if (!auth.isAuthed()) return '';
    if (a.permission === 'no') return '';

    if (a.status === 'installing') {
      return `<div class="auto-banner">Installing workflow…</div>`;
    }
    if (a.status === 'error') {
      return `
        <div class="auto-banner err-banner">
          <div><strong>Install failed</strong></div>
          <div class="muted-s">${esc(a.error || 'Unknown error')}</div>
          <div class="row-r">
            <button data-action="install-auto">Try again</button>
          </div>
        </div>
      `;
    }
    if (a.status === 'installed') {
      return `
        <div class="auto-banner ok-banner">
          <div>✓ <strong>Workflow installed</strong></div>
          <div class="muted-s">
            Add an <code>OPENAI_API_KEY</code> secret for funded AI runs.
            <a href="https://github.com/${OWNER}/${REPONAME}/settings/secrets/actions/new" target="_blank" rel="noopener">Open secrets page ↗</a>
          </div>
          <div class="muted-s">
            <a href="https://github.com/${OWNER}/${REPONAME}/actions" target="_blank" rel="noopener">View workflow runs ↗</a>
          </div>
        </div>
      `;
    }
    if (a.status === 'not-installed' && a.permission === 'yes') {
      return `
        <div class="auto-banner install-banner">
          <div>⚡ <strong>Enable always-on automation</strong></div>
          <div class="muted-s">
            Install a GitHub Action so auto-merge and community-funded AI work run even when no one is watching.
          </div>
          <div class="row-r">
            <button class="primary" data-action="install-auto">Install workflow</button>
          </div>
        </div>
      `;
    }
    return '';
  }

  // The "place" — path within the site that travels across branches.
  function pathInputHtml() {
    return `
      <div class="path-row">
        <label class="path-label">
          <span class="muted-s">Viewing</span>
          <input type="text" data-field="path" value="${esc(state.currentPath)}"
                 placeholder="index.html" spellcheck="false" />
        </label>
        <button class="apply-path" data-action="apply-path" title="Go to this path on the selected branch">Go</button>
      </div>
    `;
  }

  // ==================================================================
  // DETAIL VIEW
  // ==================================================================
  function renderDetailHtml() {
    const branch = state.detailBranch;
    const isMain = branch === 'main' || branch === 'master';
    const canMerge = auth.isAuthed() && !isMain;
    const showingThis = preview.isShowing() && state.selected === branch;
    const previewBtn = isMain
      ? ''
      : showingThis
        ? `<button data-action="close-preview">Hide preview</button>`
        : `<button data-action="show-preview">Show preview</button>`;
    return `
      <div class="hdr">
        <button class="back-btn" data-action="back">← Back</button>
        <div class="branch-title" title="${esc(branch)}">${esc(branch)}</div>
        <div class="toolbar">
          <button data-action="refresh-detail" title="Refresh">↻</button>
        </div>
      </div>
      ${pathInputHtml()}
      <div class="detail-actions">
        ${previewBtn}
        ${!isMain ? `
          <button class="primary" data-action="refine" ${auth.isAuthed() ? '' : 'disabled'}
            title="${auth.isAuthed() ? 'Continue AI work on this branch' : 'Sign in via the widget to refine'}">
            ✨ Refine with AI
          </button>
          <button data-action="merge" ${canMerge ? '' : 'disabled'}
            title="${canMerge ? 'Merge this branch into the default branch' : 'Sign in via the widget to merge'}">
            Merge to main
          </button>
        ` : ''}
      </div>
      ${state.mergeStatus === 'pending' ? `<div class="muted-s">Merging…</div>` : ''}
      ${state.mergeStatus?.ok ? `<div class="ok">Merged as <code>${esc(state.mergeStatus.sha.slice(0, 7))}</code>. Open issues closed.</div>` : ''}
      ${state.mergeStatus?.error ? `<div class="err">${esc(state.mergeStatus.error)}</div>` : ''}
      ${state.detailError ? `<div class="err">${esc(state.detailError)}</div>` : ''}
      ${state.detailLoading ? `<div class="muted-s">Loading issues…</div>` : ''}
      ${!state.detailLoading && !state.detailIssues.length && !state.detailError
        ? `<div class="muted-s">No issues reference this branch yet.</div>`
        : ''}
      ${state.detailIssues.map(renderIssueHtml).join('')}
    `;
  }

  function renderIssueHtml(issue) {
    const votes = issue.reactions?.['+1'] ?? 0;
    const commentsCount = issue.comments ?? 0;
    const expanded = state.detailExpanded.has(issue.number);
    const draft = state.detailComposeDraft.get(issue.number) || '';
    const comments = state.detailComments.get(issue.number) || null;

    return `
      <div class="issue" data-issue="${issue.number}">
        <div class="issue-hdr">
          <span class="issue-num">#${issue.number}</span>
          <span class="issue-title">${esc(issue.title)}</span>
          <span class="issue-state ${issue.state}">${issue.state}</span>
        </div>
        <div class="issue-body">${esc((issue.body || '').slice(0, 300))}${(issue.body || '').length > 300 ? '…' : ''}</div>
        <div class="vote-row">
          <button class="vote-btn" data-action="vote" data-issue="${issue.number}" ${auth.isAuthed() ? '' : 'disabled title="Sign in via the widget to vote"'}>
            👍 <span>${votes}</span>
          </button>
          <button class="comments-toggle" data-action="toggle-comments" data-issue="${issue.number}">
            ${expanded ? '▾' : '▸'} ${commentsCount} comment${commentsCount === 1 ? '' : 's'}
          </button>
          <a href="${esc(issue.html_url)}" target="_blank" rel="noopener" class="muted-s" style="margin-left:auto">open on github ↗</a>
        </div>
        ${expanded ? `
          <div class="comments">
            ${comments === null
              ? '<div class="muted-s">Loading comments…</div>'
              : comments.length
                ? comments.map(renderCommentHtml).join('')
                : '<div class="muted-s">No comments yet.</div>'}
            ${auth.isAuthed() ? `
              <div class="compose">
                <textarea data-field="comment" data-issue="${issue.number}" placeholder="Write a comment…">${esc(draft)}</textarea>
                <div class="row">
                  <button class="primary" data-action="post-comment" data-issue="${issue.number}" ${draft.trim() ? '' : 'disabled'}>Post</button>
                </div>
              </div>
            ` : '<div class="sign-in-hint">Sign in via the widget to comment.</div>'}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderCommentHtml(c) {
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

  // ==================================================================
  // Panel wiring
  // ==================================================================
  function wirePanel() {
    if (!panelEl) return;
    const on = (sel, ev, fn) => panelEl.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

    // List view
    panelEl.querySelectorAll('.branch-item').forEach((el) => {
      el.addEventListener('click', () => openDetail(el.dataset.branch));
    });
    panelEl.querySelector('[data-action="refresh"]')?.addEventListener('click', fetchBranches);
    panelEl.querySelector('[data-action="close-preview"]')?.addEventListener('click', () => {
      preview.hide();
      state.selected = null;
    });

    // Path input (present in both list + detail views).
    const pathInput = panelEl.querySelector('[data-field="path"]');
    if (pathInput) {
      pathInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setCurrentPath(pathInput.value.trim() || 'index.html');
        }
      });
    }
    panelEl.querySelector('[data-action="apply-path"]')?.addEventListener('click', () => {
      const v = panelEl.querySelector('[data-field="path"]')?.value?.trim() || 'index.html';
      setCurrentPath(v);
    });

    // Automation install
    panelEl.querySelector('[data-action="install-auto"]')?.addEventListener('click', installAutomation);

    // Detail view
    panelEl.querySelector('[data-action="back"]')?.addEventListener('click', backToList);
    panelEl.querySelector('[data-action="refresh-detail"]')?.addEventListener('click', () => loadDetail(state.detailBranch));
    panelEl.querySelector('[data-action="show-preview"]')?.addEventListener('click', () => {
      selectBranch(state.detailBranch);
    });
    panelEl.querySelector('[data-action="merge"]')?.addEventListener('click', mergeDetailBranch);
    panelEl.querySelector('[data-action="refine"]')?.addEventListener('click', refineDetailBranch);

    // Per-issue actions
    panelEl.querySelectorAll('[data-action="vote"]').forEach((el) => {
      el.addEventListener('click', () => voteOnIssue(Number(el.dataset.issue)));
    });
    panelEl.querySelectorAll('[data-action="toggle-comments"]').forEach((el) => {
      el.addEventListener('click', () => toggleComments(Number(el.dataset.issue)));
    });
    panelEl.querySelectorAll('[data-field="comment"]').forEach((ta) => {
      ta.addEventListener('input', (e) => {
        const n = Number(e.target.dataset.issue);
        state.detailComposeDraft.set(n, e.target.value);
        // Enable/disable post button
        const btn = panelEl.querySelector(`[data-action="post-comment"][data-issue="${n}"]`);
        if (btn) btn.disabled = !e.target.value.trim();
      });
    });
    panelEl.querySelectorAll('[data-action="post-comment"]').forEach((el) => {
      el.addEventListener('click', () => postComment(Number(el.dataset.issue)));
    });
  }

  // ==================================================================
  // List-view actions
  // ==================================================================
  function selectBranch(name) {
    state.selected = name;
    if (name === 'main' || name === 'master') {
      preview.hide();
    } else {
      preview.show(previewUrlFor(name));
    }
  }

  // Update the currentPath. If a preview is showing, reload it at the new path
  // on the same branch (so the user sees the same location on the same branch
  // but with a different in-site path).
  function setCurrentPath(newPath) {
    state.currentPath = newPath;
    if (preview.isShowing() && state.selected) {
      preview.show(previewUrlFor(state.selected));
    }
    if (state.open) renderPanel();
  }

  async function fetchBranches() {
    state.loading = true;
    state.error = null;
    renderPanel();
    try {
      const token = auth.getToken();
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPONAME}/branches?per_page=100`,
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
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
      state.error = String(err.message || err);
    } finally {
      state.loading = false;
      renderPanel();
    }
  }

  // ==================================================================
  // Detail navigation + loading
  // ==================================================================
  function openDetail(branchName) {
    state.view = 'detail';
    state.detailBranch = branchName;
    state.detailIssues = [];
    state.detailComments.clear();
    state.detailExpanded.clear();
    state.detailError = null;
    state.mergeStatus = null;
    // Auto-show preview when opening detail (unless main).
    if (branchName !== 'main' && branchName !== 'master') selectBranch(branchName);
    renderPanel();
    loadDetail(branchName);
  }

  function backToList() {
    state.view = 'list';
    state.detailBranch = null;
    renderPanel();
  }

  async function loadDetail(branchName) {
    state.detailLoading = true;
    state.detailError = null;
    renderPanel();
    try {
      // Search issues that reference this branch name anywhere in body/title.
      // Our widget always writes `feature/<slug>` or `auto/...` into the issue body.
      const token = auth.getToken();
      const result = await gh.searchIssues(token, OWNER, REPONAME, `"${branchName}"`);
      const issues = (result.items || []).map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body,
        state: i.state,
        html_url: i.html_url,
        comments: i.comments,
        reactions: i.reactions,
      }));
      state.detailIssues = issues;
    } catch (err) {
      state.detailError = String(err.message || err);
    } finally {
      state.detailLoading = false;
      renderPanel();
    }
  }

  // ==================================================================
  // Per-issue actions
  // ==================================================================
  async function voteOnIssue(number) {
    const token = auth.getToken();
    if (!token) return;
    try {
      await gh.addIssueReaction(token, OWNER, REPONAME, number, '+1');
      // Fetch fresh issue to get updated reaction count.
      const fresh = await gh.getIssue(token, OWNER, REPONAME, number);
      const idx = state.detailIssues.findIndex((i) => i.number === number);
      if (idx >= 0) state.detailIssues[idx].reactions = fresh.reactions;
      renderPanel();
    } catch (err) {
      state.detailError = `Vote failed: ${err.message || err}`;
      renderPanel();
    }
  }

  async function toggleComments(number) {
    if (state.detailExpanded.has(number)) {
      state.detailExpanded.delete(number);
      renderPanel();
      return;
    }
    state.detailExpanded.add(number);
    renderPanel();
    // Fetch if not already cached.
    if (!state.detailComments.has(number)) {
      try {
        const token = auth.getToken();
        const comments = await gh.listIssueComments(token, OWNER, REPONAME, number);
        state.detailComments.set(number, comments);
      } catch (err) {
        state.detailComments.set(number, []);
        state.detailError = `Could not load comments: ${err.message || err}`;
      }
      renderPanel();
    }
  }

  async function postComment(number) {
    const body = (state.detailComposeDraft.get(number) || '').trim();
    if (!body) return;
    const token = auth.getToken();
    if (!token) return;
    try {
      await gh.createIssueComment(token, OWNER, REPONAME, number, body);
      state.detailComposeDraft.set(number, '');
      // Refresh comments for this issue.
      const comments = await gh.listIssueComments(token, OWNER, REPONAME, number);
      state.detailComments.set(number, comments);
      // Update issue's comment count too.
      const idx = state.detailIssues.findIndex((i) => i.number === number);
      if (idx >= 0) state.detailIssues[idx].comments = comments.length;
      renderPanel();
    } catch (err) {
      state.detailError = `Comment failed: ${err.message || err}`;
      renderPanel();
    }
  }

  // ==================================================================
  // Merge
  // ==================================================================
  // Hand this branch to the widget so the user can continue AI work on it.
  // The widget listens for `chorus:refine` events and opens in refine mode.
  function refineDetailBranch() {
    const branch = state.detailBranch;
    if (!branch) return;
    // Pick the best associated issue as the "feature's tracking issue" — the
    // first one we found via search. If none exist, we still pass just the
    // branch; the widget handles either case.
    const issue = state.detailIssues[0] || null;
    window.dispatchEvent(new CustomEvent('chorus:refine', {
      detail: { branch, issue },
    }));
    // Close the switcher panel so the widget takes focus.
    closePanel();
  }

  async function mergeDetailBranch() {
    const branch = state.detailBranch;
    const token = auth.getToken();
    if (!token || !branch) return;
    state.mergeStatus = 'pending';
    renderPanel();
    try {
      const result = await gh.mergeBranch(token, OWNER, REPONAME, {
        base: 'main',
        head: branch,
        commit_message: `Merge branch '${branch}' via oss-kanban switcher`,
      });
      if (!result || !result.sha) {
        state.mergeStatus = { error: 'Nothing to merge (already up to date).' };
        renderPanel();
        return;
      }
      // Auto-close related issues.
      for (const issue of state.detailIssues) {
        if (issue.state === 'open') {
          await gh.setIssueState(token, OWNER, REPONAME, issue.number, 'closed').catch(() => {});
        }
      }
      state.mergeStatus = { ok: true, sha: result.sha };
      // Refresh detail + branches.
      await loadDetail(branch);
      fetchBranches();
    } catch (err) {
      state.mergeStatus = { error: String(err.message || err) };
      renderPanel();
    }
  }

  // ==================================================================
  // Cross-component events
  // ==================================================================
  window.addEventListener('oss-kanban:preview:change', () => {
    renderTrigger();
    if (state.open) renderPanel();
  });
  window.addEventListener('oss-kanban:auth:change', () => {
    refreshAutomationStatus();
    if (state.open) renderPanel();
  });
  // Initial check — if widget already authed at load, kick this off now.
  if (auth.isAuthed()) refreshAutomationStatus();

  // When the host page's own URL changes (hashchange or History pops), update
  // the tracked path. This lets the user navigate the live site and have
  // subsequent branch switches land at the same place.
  const onHostNav = () => {
    const next = initialPath();
    if (next !== state.currentPath) setCurrentPath(next);
  };
  window.addEventListener('hashchange', onHostNav);
  window.addEventListener('popstate', onHostNav);

  renderTrigger();

  if (DEBUG) {
    window.__ossKanbanSwitcherDebug = {
      state, root, trigger,
      openPanel, closePanel, openDetail, backToList,
      fetchBranches, selectBranch, loadDetail,
      voteOnIssue, toggleComments, postComment, mergeDetailBranch,
    };
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
