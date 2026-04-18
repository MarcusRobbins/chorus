// GitHub Actions runner for community-governed auto-merge.
// Invoked by .github/workflows/osskanban.yml, Node 20+.
//
// Reads open issues, extracts the branch each one references, applies pure
// rules, and merges qualifying branches into main. Logs everything to the
// Action run output so the decision trail is public and auditable.

import { evaluateIssue } from './rules.mjs';

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY || '';
const [owner, repo] = repoFull.split('/');

if (!token || !owner || !repo) {
  console.error('GITHUB_TOKEN and GITHUB_REPOSITORY env vars must be set.');
  process.exit(1);
}

const API = 'https://api.github.com';
const BASE_HEADERS = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'oss-kanban-governance-action',
};

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...BASE_HEADERS, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const listOpenIssues = () =>
  gh(`/repos/${owner}/${repo}/issues?state=open&per_page=100`);

const mergeBranchToMain = (branch, message) =>
  gh(`/repos/${owner}/${repo}/merges`, {
    method: 'POST',
    body: JSON.stringify({ base: 'main', head: branch, commit_message: message }),
  });

const closeIssue = (number) =>
  gh(`/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  });

const commentOnIssue = (number, body) =>
  gh(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

async function branchExists(name) {
  try {
    await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

function extractBranchFromBody(body) {
  if (!body) return null;
  // The widget writes either "Feature branch: `<name>`" into issue bodies or,
  // in earlier builds, "on branch `<name>`" in summary comments. Match either.
  const m =
    body.match(/(?:Feature\s+branch|branch):\s*`([^`]+)`/i) ||
    body.match(/on\s+branch\s+`([^`]+)`/i);
  return m ? m[1] : null;
}

async function main() {
  const config = {
    netVoteThreshold: Number(process.env.OSSK_VOTE_THRESHOLD || 3),
    coolOffHours: Number(process.env.OSSK_COOLOFF_HOURS || 24),
    blockLabel: process.env.OSSK_BLOCK_LABEL || 'status:blocked',
  };

  console.log(`[osskanban] ${owner}/${repo} governance pass`);
  console.log(`[osskanban] config: ${JSON.stringify(config)}`);

  const issues = await listOpenIssues();
  // /issues returns PRs too — filter them out.
  const real = issues.filter((i) => !i.pull_request);
  console.log(`[osskanban] ${real.length} open issue(s)`);

  let merged = 0;
  let skipped = 0;
  let failed = 0;

  for (const issue of real) {
    const branch = extractBranchFromBody(issue.body);
    if (!branch) {
      console.log(`[osskanban] #${issue.number} "${issue.title}" — no branch referenced, skip`);
      skipped++;
      continue;
    }

    if (!(await branchExists(branch))) {
      console.log(`[osskanban] #${issue.number} branch "${branch}" does not exist, skip`);
      skipped++;
      continue;
    }

    const decision = evaluateIssue(issue, config);
    const up = issue.reactions?.['+1'] ?? 0;
    const down = issue.reactions?.['-1'] ?? 0;

    console.log(
      `[osskanban] #${issue.number} "${issue.title}" branch=${branch} ${up}👍/${down}👎 → ${
        decision.merge ? 'MERGE' : 'skip'
      } (${decision.reason || 'OK'})`
    );

    if (!decision.merge) {
      skipped++;
      continue;
    }

    try {
      const msg = [
        `Auto-merge via community vote: ${issue.title}`,
        '',
        `${decision.net} net votes, ${decision.hoursSinceUpdate.toFixed(1)}h cool-off.`,
        '',
        `Closes #${issue.number}`,
      ].join('\n');
      await mergeBranchToMain(branch, msg);
      await closeIssue(issue.number);
      await commentOnIssue(
        issue.number,
        `🤖 **Auto-merged via community vote.** ` +
          `${decision.net} net votes, ${decision.hoursSinceUpdate.toFixed(1)}h since last activity. ` +
          `See [Action run](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID || ''}).`
      );
      merged++;
    } catch (err) {
      console.error(`[osskanban] #${issue.number} merge failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`[osskanban] done: ${merged} merged, ${skipped} skipped, ${failed} failed.`);
}

main().catch((err) => {
  console.error('[osskanban] fatal:', err);
  process.exit(1);
});
