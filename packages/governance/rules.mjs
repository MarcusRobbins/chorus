// Pure governance rules. Given an issue from GitHub's API plus config,
// returns a merge decision. No I/O — fully testable, portable.
//
// Used by the GitHub Action runner and can also be called from the switcher's
// browser-mode "operator watcher" if we re-enable that path.

export function evaluateIssue(issue, config = {}) {
  const {
    netVoteThreshold = 3,
    coolOffHours = 24,
    blockLabel = 'status:blocked',
  } = config;

  if (issue.state !== 'open') {
    return { merge: false, reason: 'issue not open' };
  }

  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  if (labels.includes(blockLabel)) {
    return { merge: false, reason: `blocked by ${blockLabel} label` };
  }

  const upvotes = issue.reactions?.['+1'] ?? 0;
  const downvotes = issue.reactions?.['-1'] ?? 0;
  const net = upvotes - downvotes;
  if (net < netVoteThreshold) {
    return { merge: false, reason: `net votes ${net} < threshold ${netVoteThreshold}`, net };
  }

  const lastActivity = new Date(issue.updated_at).getTime();
  const hoursSinceUpdate = (Date.now() - lastActivity) / (1000 * 60 * 60);
  if (hoursSinceUpdate < coolOffHours) {
    return {
      merge: false,
      reason: `cooling off (${hoursSinceUpdate.toFixed(1)}h < ${coolOffHours}h)`,
      net,
      hoursSinceUpdate,
    };
  }

  return { merge: true, net, hoursSinceUpdate };
}
