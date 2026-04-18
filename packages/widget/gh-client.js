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

// --- tree + file reads ----------------------------------------------------

// Recursive tree at a ref. Returns { sha, tree: [{path, mode, type, sha, size}] }
export const listTree = (token, owner, repo, ref) =>
  gh(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);

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
