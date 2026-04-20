// GitHub REST helpers used by the widget.
// Every function takes an OAuth token (no module-level state).
// Errors throw with a message you can show the user.

const API = 'https://api.github.com';

function buildHeaders(token, extra = {}) {
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    ...extra,
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function gh(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: buildHeaders(token, init.headers),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Also update the readFile fetch to pass headers through buildHeaders — the
// existing implementation builds its own headers and doesn't go through gh().
// We leave it as-is for now (it works) but be aware.

// --- user / repo metadata -------------------------------------------------

export const fetchUser = (token) =>
  gh(token, '/user');

export const getRepo = (token, owner, repo) =>
  gh(token, `/repos/${owner}/${repo}`);

// --- issue search + discussion + reactions --------------------------------

// Find issues whose title/body mentions a query string, e.g. a branch name.
// Token is optional (unauth works on public repos with a stricter rate limit).
export const searchIssues = (token, owner, repo, query) =>
  gh(token, `/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} ${query}`)}&sort=created&order=asc&per_page=50`);

export const listIssueComments = (token, owner, repo, number) =>
  gh(token, `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);

// Add a reaction to an issue. `content` is one of: +1, -1, laugh, confused,
// heart, hooray, rocket, eyes. 201 on new, 200 on existing.
export const addIssueReaction = (token, owner, repo, number, content = '+1') =>
  gh(token, `/repos/${owner}/${repo}/issues/${number}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

// Same, but on an individual comment (identified by its comment ID, not by
// the issue number). Used for comment up/down-votes.
export const addCommentReaction = (token, owner, repo, commentId, content = '+1') =>
  gh(token, `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

// Fetch an issue by number (to get fresh reactions object after voting).
export const getIssue = (token, owner, repo, number) =>
  gh(token, `/repos/${owner}/${repo}/issues/${number}`);

// Close or reopen an issue.
export const setIssueState = (token, owner, repo, number, stateValue) =>
  gh(token, `/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: stateValue }),
  });

// --- merge ----------------------------------------------------------------

// Merge `head` branch into `base` branch. Returns the merge commit, or null
// if the branch is already up to date (204).
// Throws on conflict (409) or permission error (403/404).
export const mergeBranch = (token, owner, repo, { base, head, commit_message }) =>
  gh(token, `/repos/${owner}/${repo}/merges`, {
    method: 'POST',
    body: JSON.stringify({ base, head, commit_message }),
  });

// --- issues + comments ----------------------------------------------------

export const createIssue = (token, owner, repo, { title, body, labels }) =>
  gh(token, `/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify(labels ? { title, body, labels } : { title, body }),
  });

export const createIssueComment = (token, owner, repo, number, body) =>
  gh(token, `/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

// --- element-pinned discussion threads ------------------------------------
//
// Threads are GitHub issues with a 'chorus:thread' label. Element metadata
// (selector, text, page path, bounding box) is embedded in the issue body
// inside an HTML-comment block so it's machine-readable but invisible on
// github.com. Replies are ordinary issue comments.
//
// Promoting a thread to a ticket = remove the label, add any ticket-side
// metadata, and trigger the AI flow against a new branch.

const THREAD_LABEL = 'chorus:thread';
const THREAD_META_OPEN = '<!-- chorus-thread-meta';
const THREAD_META_CLOSE = '-->';

export function buildThreadBody({ meta, text }) {
  const metaBlob = typeof meta === 'string' ? meta : JSON.stringify(meta);
  return `${THREAD_META_OPEN}\n${metaBlob}\n${THREAD_META_CLOSE}\n\n${text || ''}`.trim();
}

export function parseThreadMeta(body) {
  if (!body) return null;
  const open = body.indexOf(THREAD_META_OPEN);
  if (open < 0) return null;
  const close = body.indexOf(THREAD_META_CLOSE, open);
  if (close < 0) return null;
  const raw = body.slice(open + THREAD_META_OPEN.length, close).trim();
  try { return JSON.parse(raw); } catch { return null; }
}

export function stripThreadMeta(body) {
  if (!body) return '';
  const open = body.indexOf(THREAD_META_OPEN);
  if (open < 0) return body;
  const close = body.indexOf(THREAD_META_CLOSE, open);
  if (close < 0) return body;
  return (body.slice(0, open) + body.slice(close + THREAD_META_CLOSE.length)).trim();
}

// List open discussion threads for this repo. Uses GitHub's label filter.
// Optionally narrow to a specific page path (client-side filter — path lives
// in body metadata, not a label) and/or a specific feature (server-side AND
// filter via an additional chorus:feature:<name> label).
export async function listDiscussionThreads(
  token, owner, repo,
  { page, state = 'open', featureName } = {},
) {
  const qs = new URLSearchParams();
  const labels = [THREAD_LABEL];
  if (featureName) {
    // Inline to avoid forward reference to featureLabelName (same file,
    // defined later — would be hoisted as a function decl, but keeping
    // this self-contained is clearer).
    const slug = String(featureName).toLowerCase().trim()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    if (slug) labels.push(`chorus:feature:${slug}`);
  }
  qs.set('labels', labels.join(','));
  qs.set('state', state);
  qs.set('per_page', '100');
  const issues = await gh(token, `/repos/${owner}/${repo}/issues?${qs.toString()}`);
  // Filter out pull requests (GitHub returns PRs in /issues too).
  const threads = issues.filter((i) => !i.pull_request).map((i) => {
    const meta = parseThreadMeta(i.body || '');
    return {
      number: i.number,
      title: i.title,
      state: i.state,
      html_url: i.html_url,
      user: i.user,
      comments: i.comments,
      created_at: i.created_at,
      updated_at: i.updated_at,
      meta,
      initialText: stripThreadMeta(i.body || ''),
    };
  });
  if (!page) return threads;
  return threads.filter((t) => t.meta?.page === page);
}

// Create a new discussion thread pinned to an element. Returns the full
// issue object (caller typically just needs .number).
// Optionally attach feature tags (array of feature names). Features must
// already exist; if a name doesn't resolve to a label, GitHub will 422 and
// we'll throw. Caller should ensure the feature exists first (or create it).
export async function createDiscussionThread(token, owner, repo, { title, text, meta, features = [] }) {
  // Ensure the label exists; GitHub silently succeeds if it already does.
  // We don't await this — if creation races, the issue is still valid;
  // the label just won't be attached and the thread won't show in the list
  // until applied.
  safeEnsureLabel(token, owner, repo, THREAD_LABEL, '4f46e5', 'Chorus element-pinned discussion');
  const labels = [THREAD_LABEL];
  for (const name of features || []) {
    const slug = slugifyFeatureName(name);
    if (slug) labels.push(featureLabelName(slug));
  }
  return gh(token, `/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: title || 'Discussion',
      body: buildThreadBody({ meta, text }),
      labels,
    }),
  });
}

// Update a thread's pinned-element metadata (and/or its text) by rewriting
// the issue body. Existing text and meta are both replaced — pass the current
// text through if you only want to update the meta.
export async function updateThreadMeta(token, owner, repo, number, { meta, text }) {
  const body = buildThreadBody({ meta, text });
  return gh(token, `/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

// Remove the thread label so the issue becomes a regular ticket.
// GitHub's label-removal endpoint is label-specific; we use it to avoid
// clobbering any other labels on the issue.
export const promoteThreadToTicket = (token, owner, repo, number) =>
  gh(token, `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(THREAD_LABEL)}`, {
    method: 'DELETE',
  });

// Fetch a single thread with all its comments. Shape:
//   { issue, comments: [{id, user, body, created_at, ...}] }
export async function getDiscussionThread(token, owner, repo, number) {
  const [issue, comments] = await Promise.all([
    gh(token, `/repos/${owner}/${repo}/issues/${number}`),
    gh(token, `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`),
  ]);
  return {
    issue,
    meta: parseThreadMeta(issue.body || ''),
    initialText: stripThreadMeta(issue.body || ''),
    comments,
  };
}

// --- features (subreddit-style topic scopes) ------------------------------
//
// A feature is a GitHub label with the prefix `chorus:feature:`. The feature
// name is whatever follows the prefix. The label description doubles as the
// feature's own description. Colour is mostly cosmetic (shown as a swatch in
// the UI) but users can pick one when creating.
//
// Threads / branches / proposals are "in" a feature by being tagged with the
// corresponding `chorus:feature:<name>` label. Tagging is composable — one
// item can belong to many features.

const FEATURE_LABEL_PREFIX = 'chorus:feature:';

// Small random-ish default colour for newly created features. Kept short;
// GitHub expects 6-hex with no leading '#'. We pick from a palette so two
// sibling features don't collide by default.
const FEATURE_PALETTE = [
  '4f46e5', '0ea5e9', '14b8a6', '10b981', '84cc16',
  'f59e0b', 'ef4444', 'ec4899', '8b5cf6', '64748b',
];
export function defaultFeatureColor(seed = '') {
  const h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  return FEATURE_PALETTE[Math.abs(h) % FEATURE_PALETTE.length];
}

// Validate/sanitise a user-typed feature name to a slug suitable for a
// label. Labels can contain most characters but we keep it tight for
// readability: lowercase, alnum + dash + underscore.
export function slugifyFeatureName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function featureLabelName(name) {
  return `${FEATURE_LABEL_PREFIX}${slugifyFeatureName(name)}`;
}

// List all features. One GH API call (labels are paginated; we take the
// first 100 which is plenty for a v1).
export async function listFeatures(token, owner, repo) {
  const labels = await gh(token, `/repos/${owner}/${repo}/labels?per_page=100`);
  return labels
    .filter((l) => typeof l.name === 'string' && l.name.startsWith(FEATURE_LABEL_PREFIX))
    .map((l) => ({
      name: l.name.slice(FEATURE_LABEL_PREFIX.length),
      rawName: l.name,
      description: l.description || '',
      color: l.color || '64748b',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Create a feature. Returns the normalised feature shape (same as listFeatures).
// Throws on duplicate (422 from GitHub) — caller should surface a friendly error.
export async function createFeature(token, owner, repo, { name, description, color }) {
  const slug = slugifyFeatureName(name);
  if (!slug) throw new Error('Feature name is required');
  const labelName = featureLabelName(slug);
  const labelColor = (color || defaultFeatureColor(slug)).replace(/^#/, '');
  const created = await gh(token, `/repos/${owner}/${repo}/labels`, {
    method: 'POST',
    body: JSON.stringify({
      name: labelName,
      color: labelColor,
      description: description || '',
    }),
  });
  return {
    name: slug,
    rawName: created.name,
    description: created.description || '',
    color: created.color || labelColor,
  };
}

async function safeEnsureLabel(token, owner, repo, name, color, description) {
  try {
    await gh(token, `/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name, color, description }),
    });
  } catch (err) {
    // 422 = already exists, anything else we just log-and-swallow.
    if (!String(err.message || '').includes(' 422')) {
      console.warn('[chorus] ensureLabel', name, err?.message || err);
    }
  }
}

// --- tree + file reads ----------------------------------------------------

// Recursive tree at a ref. Returns { sha, tree: [{path, mode, type, sha, size}] }
export const listTree = (token, owner, repo, ref) =>
  gh(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);

// Compare two refs. Returns { merge_base_commit, commits: [...] }.
// Used by the phylogeny viewer to find where a feature branch diverged from
// main and what commits happened on it.
export const compareCommits = (token, owner, repo, base, head) =>
  gh(token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100`);

// List commits on a ref. Returns the most recent first. Each element has
// .sha, .parents[].sha, .commit.author.date, .commit.message, etc.
export const listCommits = (token, owner, repo, { sha, perPage = 100 } = {}) => {
  const qs = new URLSearchParams();
  if (sha) qs.set('sha', sha);
  qs.set('per_page', String(perPage));
  return gh(token, `/repos/${owner}/${repo}/commits?${qs.toString()}`);
};

// Read a file at a ref. Returns decoded utf-8 string. Null if file doesn't exist.
export async function readFile(token, owner, repo, path, ref) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}${q}`;
  const res = await fetch(url, { headers: buildHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} read ${path}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (Array.isArray(data)) throw new Error(`${path} is a directory, not a file`);
  if (data.encoding !== 'base64') throw new Error(`unexpected encoding ${data.encoding}`);
  return decodeBase64Utf8(data.content);
}

function decodeBase64Utf8(b64) {
  // Remove whitespace/newlines GitHub inserts, then decode.
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// Put (create or update) a single file on the default branch (or a specified
// one). Returns the response with the new blob/commit SHAs.
// Good for small single-file commits like installing a workflow; for multi-
// file atomic commits, use commitFiles.
export async function putFile(token, owner, repo, path, { content, message, branch, committer }) {
  const apiPath = `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;

  // If the file already exists, we need its current sha to update it.
  let sha;
  try {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const existing = await gh(token, apiPath + q);
    if (existing && !Array.isArray(existing)) sha = existing.sha;
  } catch (err) {
    if (!String(err.message).includes(' 404')) throw err;
    // 404: file doesn't exist, creating fresh
  }

  // utf-8-safe base64 encoding in the browser
  const b64 = btoa(unescape(encodeURIComponent(content)));

  const body = { message, content: b64 };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;
  if (committer) body.committer = committer;

  return gh(token, apiPath, { method: 'PUT', body: JSON.stringify(body) });
}

// --- workflow runs (for verifying Action install) -------------------------

export const listWorkflowRuns = (token, owner, repo, workflowFile) =>
  gh(token, `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=5`);

// --- git data api: atomic multi-file commit ------------------------------

// Commit a set of files to a branch. If the branch doesn't exist yet, create
// it from `startFrom`. If it does exist, append a new commit on top.
//
// `branch`: target branch name
// `startFrom`: base branch to fork from if the target branch doesn't yet exist
// `files`: Map or object of { path: content_string }
// Returns { sha: <new commit sha>, created: <boolean> }.
export async function commitFiles(token, owner, repo, {
  branch, startFrom, message, files,
}) {
  const entries = files instanceof Map ? [...files] : Object.entries(files);
  if (!entries.length) throw new Error('commitFiles: no files to commit');

  // 1. Determine where we're committing on top of.
  let parentSha;
  let branchExists = true;
  try {
    const ref = await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`);
    parentSha = ref.object.sha;
  } catch (err) {
    if (!String(err.message).includes(' 404')) throw err;
    branchExists = false;
    if (!startFrom) throw new Error(`branch ${branch} does not exist and no startFrom provided`);
    const baseRef = await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(startFrom)}`);
    parentSha = baseRef.object.sha;
  }

  const parentCommit = await gh(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const parentTreeSha = parentCommit.tree.sha;

  // 2. One blob per file.
  const treeEntries = [];
  for (const [path, content] of entries) {
    const blob = await gh(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3. New tree based on parent's tree.
  const newTree = await gh(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentTreeSha, tree: treeEntries }),
  });

  // 4. New commit.
  const newCommit = await gh(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
  });

  // 5. Either create or fast-forward the branch.
  if (branchExists) {
    await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    });
  } else {
    await gh(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha }),
    });
  }

  return { sha: newCommit.sha, created: !branchExists };
}
