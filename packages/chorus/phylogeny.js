// Phylogeny viewer for a repo's branches + commits.
//
// Design notes (cribbed from Nextstrain/Auspice, see the session this was
// built in for the full pattern-list):
//  - Shell separation: topology (sha/parents/date/refs) lives on the node;
//    render state (x/y/paths) lives on a shell that shares an array index.
//  - Hand-rolled path strings, no d3.linkHorizontal().
//  - Rectangular elbow = 'M xBase,yBase L xTip,yBase L xTip,yTip'.
//  - LOD labels (threshold on visible-tip count, not per-pair collision).
//  - Focus = re-layout with a subset, not d3-zoom pan/zoom.
//
// v1 simplifications:
//  - Lane-per-branch: main is one lane, each feature/auto branch gets its
//    own lane. Commits that exist on a branch sit on that branch's lane.
//    Auspice's post-order DFS would buy us more nuance once branches nest,
//    which git branches don't, usually.
//  - Merge commits sit on their PRIMARY parent's lane (so main doesn't
//    wobble when a branch merges in). Secondary parents render as a cubic
//    Bezier from the side-branch tip into the merge point.
//  - No canvas fallback; SVG throughout. Fine below ~5k commits.

import { scaleTime, scaleLinear } from 'https://esm.sh/d3-scale@4';

const NS = 'http://www.w3.org/2000/svg';

// ── Data loader ───────────────────────────────────────────────────
// Fetches branches + per-branch commit comparisons against main.
// Returns { commits: Map<sha, Commit>, branches: Branch[] }.
//
//   Commit: { sha, parents: string[], timestamp, author, message, refs: Set<string> }
//   Branch: { name, tipSha, isMain, category: 'main'|'feature'|'auto'|'misc' }

export async function loadPhylogenyData({ token, owner, repo, branches, gh }) {
  const mainBranch = branches.find((b) => b.name === 'main' || b.name === 'master');
  const mainName = mainBranch?.name || 'main';
  const mainTipSha = mainBranch?.commit?.sha || null;

  const commits = new Map();

  // Helper: add commit to the map, merging refs if already present.
  const addCommit = (c, branchName) => {
    const existing = commits.get(c.sha);
    if (existing) {
      existing.refs.add(branchName);
      return;
    }
    commits.set(c.sha, {
      sha: c.sha,
      parents: (c.parents || []).map((p) => p.sha),
      timestamp: new Date(c.commit?.author?.date || c.commit?.committer?.date || 0),
      author: c.commit?.author?.name || c.author?.login || 'unknown',
      message: (c.commit?.message || '').split('\n')[0],
      refs: new Set([branchName]),
    });
  };

  // Fetch main's own history first. Without this, main's tip commit has no
  // parent in our graph — so no stem connects it to the merge-base points
  // on main, and main appears as a lone dot floating on the right.
  // 100 commits is usually plenty; we can paginate later if needed.
  const tasks = [];
  tasks.push((async () => {
    try {
      const mainCommits = await gh.listCommits(token, owner, repo, { sha: mainName, perPage: 100 });
      for (const c of mainCommits || []) addCommit(c, mainName);
    } catch (err) {
      console.warn('[phylogeny] listCommits(main) failed', err?.message || err);
    }
  })());

  // For each non-main branch, fetch the compare payload. That gives us the
  // merge base (divergence point on main) plus every commit on the branch
  // since divergence. We also pick up the merge base commit itself so the
  // elbow has somewhere to attach.
  for (const b of branches.filter((b) => b.name !== mainName)) {
    tasks.push((async () => {
      try {
        const cmp = await gh.compareCommits(token, owner, repo, mainName, b.name);
        if (cmp.merge_base_commit) addCommit(cmp.merge_base_commit, mainName);
        for (const c of cmp.commits || []) addCommit(c, b.name);
      } catch (err) {
        // Rate-limit / 404 — skip this branch's history, keep its tip visible.
        console.warn('[phylogeny] compare failed for', b.name, err?.message || err);
      }
    })());
  }
  await Promise.allSettled(tasks);

  // If main's tip still isn't in the map (empty history, API error) stub it
  // so it doesn't vanish entirely.
  if (mainTipSha && !commits.has(mainTipSha)) {
    commits.set(mainTipSha, {
      sha: mainTipSha,
      parents: [],
      timestamp: new Date(),
      author: 'unknown',
      message: '(main)',
      refs: new Set([mainName]),
    });
  }

  return {
    commits,
    mainName,
    branches: branches.map((b) => ({
      name: b.name,
      tipSha: b.commit?.sha || null,
      isMain: b.name === mainName,
      category: b.name === mainName
        ? 'main'
        : b.name.startsWith('feature/') ? 'feature'
        : b.name.startsWith('auto/') ? 'auto'
        : 'misc',
    })),
  };
}

// ── Layout ────────────────────────────────────────────────────────
// Compute per-commit render positions + path strings. Pure function of
// data + viewport. Mutates commits with {x, y, xTip, yTip, xBase, yBase,
// branchPath, mergeEdges, lane, pickBranch}.

function computeLayout({ commits, branches, mainName }, { width, height }) {
  // Reachability: for each branch, which commits in our map can we walk
  // to via ANY parent pointer starting from the branch tip. BFS bounded
  // by commits we've actually fetched.
  function reachableFrom(tipSha) {
    const seen = new Set();
    if (!tipSha) return seen;
    const stack = [tipSha];
    while (stack.length) {
      const sha = stack.pop();
      if (seen.has(sha)) continue;
      const c = commits.get(sha);
      if (!c) continue;
      seen.add(sha);
      for (const p of c.parents) stack.push(p);
    }
    return seen;
  }

  // Main's 'trunk' = first-parent-only walk from main's tip. Commits
  // reached via merge commits' SECOND parents are NOT on the trunk
  // (they're the branch that was merged in).
  const mainBranch = branches.find((b) => b.name === mainName);
  const mainTrunk = new Set();
  if (mainBranch?.tipSha) {
    let cursor = mainBranch.tipSha;
    let safety = 10000;
    while (cursor && !mainTrunk.has(cursor) && safety-- > 0) {
      mainTrunk.add(cursor);
      const c = commits.get(cursor);
      cursor = c?.parents?.[0] || null;
    }
  }

  // commitsByBranch[name] = commits introduced by this branch (reachable
  // from tip but not on main's trunk).
  const commitsByBranch = new Map();
  for (const b of branches) {
    if (b.isMain) continue;
    const reach = reachableFrom(b.tipSha);
    const own = new Set();
    for (const sha of reach) if (!mainTrunk.has(sha)) own.add(sha);
    commitsByBranch.set(b.name, own);
  }

  const nonMainNames = branches.filter((b) => !b.isMain).map((b) => b.name);
  for (const c of commits.values()) {
    if (mainTrunk.has(c.sha)) {
      c.pickBranch = mainName;
    } else {
      // First branch whose 'own' set contains this commit.
      c.pickBranch = nonMainNames.find((bn) => commitsByBranch.get(bn)?.has(c.sha)) || mainName;
    }
  }

  // For each non-main branch: did it get merged back into main, and if so,
  // which commit on main's trunk is the merge commit? We look for a merge
  // commit on main's trunk whose second-parent subtree contains the
  // branch's tip.
  const mergeCommitByBranch = new Map();
  for (const b of branches) {
    if (b.isMain || !b.tipSha) continue;
    // Walk main's trunk, for each merge commit check if parents[1] can
    // reach the branch's tip.
    let found = null;
    for (const sha of mainTrunk) {
      const c = commits.get(sha);
      if (!c || c.parents.length < 2) continue;
      const reachFromSecondary = reachableFrom(c.parents[1]);
      if (reachFromSecondary.has(b.tipSha)) {
        // Pick the OLDEST such merge commit (the one closest to the branch
        // tip in time) — that's the actual 'when it rejoined main' point.
        if (!found || c.timestamp < found.timestamp) found = c;
      }
    }
    if (found) mergeCommitByBranch.set(b.name, found);
  }

  // Lane assignment: main at the bottom (visual "trunk / foundation"),
  // feature branches stacked above it. Simple stable order by branch list
  // (features first, then autos, then misc — whatever the caller passed).
  // The metaphor is that features *grow up and out of* main, rather than
  // hanging off it symmetrically — reads as evolution / accretion.
  const lanes = new Map();
  const nonMain = branches.filter((b) => !b.isMain);
  nonMain.forEach((b, i) => lanes.set(b.name, i));
  lanes.set(mainName, nonMain.length); // bottom-most lane

  // Time scale: oldest commit → left, newest → right. Add a small pad on
  // the left for the tip labels room; right pad for branch-tip labels.
  const times = [...commits.values()].map((c) => c.timestamp.getTime()).filter(Boolean);
  if (!times.length) return { xScale: null, yScale: null };
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  // If the whole history fits in an instant, fake a minute span so the
  // axis has some extent.
  const tExtent = tMax - tMin > 0 ? [tMin, tMax] : [tMin - 60e3, tMin + 60e3];
  const xPadLeft = 20;
  const xPadRight = 180; // branch tip labels
  const xScale = scaleTime()
    .domain(tExtent)
    .range([xPadLeft, width - xPadRight]);

  // Lane → y. Centered vertically; each lane is a fixed row height.
  const uniqueLanes = [...new Set(lanes.values())].sort((a, b) => a - b);
  const laneCount = uniqueLanes.length;
  const rowHeight = Math.max(24, Math.min(40, (height - 60) / Math.max(1, laneCount)));
  const yCenter = height / 2;
  const yScale = scaleLinear()
    .domain([Math.min(...uniqueLanes), Math.max(...uniqueLanes)])
    .range([yCenter - ((laneCount - 1) / 2) * rowHeight, yCenter + ((laneCount - 1) / 2) * rowHeight]);

  // Position each commit
  for (const c of commits.values()) {
    c.x = xScale(c.timestamp);
    c.lane = lanes.get(c.pickBranch) ?? 0;
    c.y = yScale(c.lane);
  }

  // Per-lane min-spacing. Commits whose timestamps are close together
  // would otherwise produce elbow corners stacked on top of each other —
  // making independent branches look like they're related (e.g. test5
  // appearing to branch off menu just because its divergence timestamp
  // is near menu's merge timestamp). Walk each lane left-to-right and
  // nudge commits forward so no two are within MIN_COMMIT_DX of each
  // other on the same lane. This distorts the time scale slightly for
  // clustered regions but keeps topology legible.
  //
  // Elbow corners (divergence + rejoin) inherit the nudged x values
  // automatically because they're derived from commit.x at render time.
  const MIN_COMMIT_DX = 28;
  const byLane = new Map();
  for (const c of commits.values()) {
    if (!byLane.has(c.lane)) byLane.set(c.lane, []);
    byLane.get(c.lane).push(c);
  }
  for (const laneCommits of byLane.values()) {
    laneCommits.sort((a, b) => a.x - b.x);
    for (let i = 1; i < laneCommits.length; i++) {
      const prev = laneCommits[i - 1];
      const curr = laneCommits[i];
      if (curr.x - prev.x < MIN_COMMIT_DX) {
        curr.x = prev.x + MIN_COMMIT_DX;
      }
    }
  }

  // Second pass: divergence points across lanes. A "divergence point" is
  // a commit whose primary parent lives on a different lane — its elbow
  // corner drops vertically through main's lane at that x. Two branches
  // diverging at similar timestamps end up with verticals stacked on top
  // of each other, making one look like it branched off the other. Nudge
  // divergence commits apart globally so their elbow verticals don't
  // collide.
  const MIN_DIVERGENCE_DX = 40;
  const divergencePoints = [];
  for (const c of commits.values()) {
    const p1 = c.parents[0] && commits.get(c.parents[0]);
    if (p1 && p1.lane !== c.lane) divergencePoints.push(c);
  }
  divergencePoints.sort((a, b) => a.x - b.x);
  for (let i = 1; i < divergencePoints.length; i++) {
    const prev = divergencePoints[i - 1];
    const curr = divergencePoints[i];
    if (curr.x - prev.x < MIN_DIVERGENCE_DX) {
      curr.x = prev.x + MIN_DIVERGENCE_DX;
    }
  }

  // Branch tip positions + rejoin paths.
  // A branch is "merged back" if main's trunk contains a merge commit
  // whose second-parent subtree reaches this branch's tip. The rejoin is
  // drawn as a right-angle elbow (matching the stem style) from the
  // branch's last own commit → horizontally to the merge commit's x →
  // vertically down to main's lane. Minimum horizontal extent enforced so
  // the elbow reads even when the merge happened seconds after the last
  // branch commit (and would otherwise collapse to a vertical line).
  const branchTipPositions = branches.map((b) => {
    const tipCommit = commits.get(b.tipSha);
    if (!tipCommit) return null;
    const lane = lanes.get(b.name) ?? 0;
    const y = yScale(lane);

    // Last own commit = most recent commit in commitsByBranch[name].
    const ownSet = commitsByBranch.get(b.name);
    let lastOwnCommit = null;
    if (ownSet && ownSet.size) {
      let latestTs = -Infinity;
      for (const sha of ownSet) {
        const c = commits.get(sha);
        if (c && c.timestamp.getTime() > latestTs) {
          latestTs = c.timestamp.getTime();
          lastOwnCommit = c;
        }
      }
    }
    const mergeCommit = mergeCommitByBranch.get(b.name) || null;
    const mergedBack = !!mergeCommit || (!ownSet?.size && !b.isMain && mainTrunk.has(b.tipSha));

    // Right-angle rejoin elbow (replaces the previous cubic Bezier).
    // L-shape: lastOwn → horizontal to cornerX → vertical to main lane →
    // horizontal to mergeCommit.x. Matches the stem style throughout.
    let rejoinPath = null;
    const MIN_ELBOW_DX = 40;
    if (mergeCommit && lastOwnCommit) {
      const actualDx = mergeCommit.x - lastOwnCommit.x;
      const cornerX = actualDx >= MIN_ELBOW_DX
        ? mergeCommit.x
        : lastOwnCommit.x + MIN_ELBOW_DX;
      rejoinPath = `M ${lastOwnCommit.x},${lastOwnCommit.y} L ${cornerX},${lastOwnCommit.y} L ${cornerX},${mergeCommit.y} L ${mergeCommit.x},${mergeCommit.y}`;
    }

    // Fallback dashed pointer for FF-merged / pure-alias branches (no
    // own commits to anchor an elbow).
    const pointerPath = (mergedBack && !lastOwnCommit)
      ? `M ${tipCommit.x},${y} L ${tipCommit.x},${tipCommit.y}`
      : null;

    return {
      branch: b,
      commit: tipCommit,
      lastOwnCommit,
      mergeCommit,
      x: lastOwnCommit ? lastOwnCommit.x : tipCommit.x,
      y: lastOwnCommit ? lastOwnCommit.y : y,
      lane,
      mergedBack,
      rejoinPath,
      pointerPath,
    };
  }).filter(Boolean);

  // Compute branch-path strings per commit. For a commit with parents, we
  // draw a stem from its primary parent to itself. The stem is:
  //   - pure horizontal if same lane as parent
  //   - an elbow (horizontal to parent.x, then vertical up/down, then
  //     horizontal to child.x... actually it's parent.x horizontal to
  //     child.x at parent.y, then vertical from parent.y to child.y at
  //     child.x) when lane changes.
  // Secondary parents get a cubic Bezier into the merge commit.
  for (const c of commits.values()) {
    c.branchPath = '';
    c.mergeEdges = [];
    const [primaryParentSha, ...secondaryShas] = c.parents;
    const p1 = primaryParentSha ? commits.get(primaryParentSha) : null;
    if (p1) {
      if (Math.abs(p1.y - c.y) < 0.5) {
        // Same lane: straight horizontal.
        c.branchPath = `M ${p1.x},${p1.y} L ${c.x},${c.y}`;
      } else {
        // Lane change: elbow at child.x (so the vertical jog happens AT the
        // new commit — this is the Auspice-style 'branch point at the
        // destination' shape). Reads as 'here's where we left main'.
        c.branchPath = `M ${p1.x},${p1.y} L ${c.x},${p1.y} L ${c.x},${c.y}`;
      }
    }
    for (const sSha of secondaryShas) {
      const sp = commits.get(sSha);
      if (!sp) continue;
      // Cubic Bezier from secondary parent tip to merge commit, bowing out
      // sideways so it doesn't overlap the stem. Control points flare
      // horizontally 40% of the x-distance.
      const dx = c.x - sp.x;
      c.mergeEdges.push(
        `M ${sp.x},${sp.y} C ${sp.x + dx * 0.4},${sp.y} ${c.x - dx * 0.4},${c.y} ${c.x},${c.y}`
      );
    }
  }

  return { xScale, yScale, laneCount, rowHeight, branchTipPositions };
}

// ── Render ────────────────────────────────────────────────────────

export function createPhylogeny(container, { onSelectBranch } = {}) {
  // Build the surface once; subsequent render() calls replace content.
  container.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'phylogeny-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';

  // Layers: stems (bottom), merges, dots+labels (top).
  const gMerges = document.createElementNS(NS, 'g');
  gMerges.setAttribute('class', 'phy-merges');
  const gStems = document.createElementNS(NS, 'g');
  gStems.setAttribute('class', 'phy-stems');
  const gDots = document.createElementNS(NS, 'g');
  gDots.setAttribute('class', 'phy-dots');
  const gLabels = document.createElementNS(NS, 'g');
  gLabels.setAttribute('class', 'phy-labels');
  svg.appendChild(gStems);
  svg.appendChild(gMerges);
  svg.appendChild(gDots);
  svg.appendChild(gLabels);
  container.appendChild(svg);

  // Tooltip element in the container
  const tooltip = document.createElement('div');
  tooltip.className = 'phy-tooltip';
  tooltip.style.display = 'none';
  container.appendChild(tooltip);

  let currentData = null;
  let currentHighlight = null;

  function layoutAndPaint(data, highlight) {
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 400);
    const height = Math.max(rect.height, 180);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const { xScale, branchTipPositions } = computeLayout(data, { width, height });
    if (!xScale) {
      gStems.innerHTML = '';
      gMerges.innerHTML = '';
      gDots.innerHTML = '';
      gLabels.innerHTML = '';
      return;
    }

    // Stems.
    const stemsHtml = [];
    for (const c of data.commits.values()) {
      if (!c.branchPath) continue;
      const cls = 'phy-stem' + (c.pickBranch === 'main' ? ' main' : ` ${categoryOf(c.pickBranch)}`);
      stemsHtml.push(`<path class="${cls}" d="${c.branchPath}"/>`);
    }

    // Rejoin curves for branches that have been merged back into main.
    // Drawn in the stems layer so they sit beneath dots but above the
    // main trunk line.
    for (const tip of branchTipPositions) {
      if (tip.rejoinPath) {
        stemsHtml.push(`<path class="phy-rejoin ${categoryOf(tip.branch.name)}" d="${tip.rejoinPath}"/>`);
      } else if (tip.pointerPath) {
        // Fallback for pure-alias branches with no own commits: dashed stub.
        stemsHtml.push(`<path class="phy-pointer ${categoryOf(tip.branch.name)}" d="${tip.pointerPath}"/>`);
      }
    }
    gStems.innerHTML = stemsHtml.join('');

    // Merges.
    const mergeHtml = [];
    for (const c of data.commits.values()) {
      for (const path of c.mergeEdges || []) {
        mergeHtml.push(`<path class="phy-merge" d="${path}"/>`);
      }
    }
    gMerges.innerHTML = mergeHtml.join('');

    // Commit dots — v1 shows only merge commits here. Branch tips get
    // their own dots in a separate pass below (they may sit on a lane
    // different from the underlying commit's pickBranch lane).
    const dotsHtml = [];
    const branchTipShas = new Set(data.branches.map((b) => b.tipSha).filter(Boolean));
    for (const c of data.commits.values()) {
      const isMerge = (c.parents?.length || 0) >= 2;
      const isTip = branchTipShas.has(c.sha);
      if (!isMerge || isTip) continue; // tips handled separately
      const cat = categoryOf(c.pickBranch);
      const cls = `phy-dot ${cat} merge`;
      dotsHtml.push(`<circle class="${cls}" cx="${c.x}" cy="${c.y}" r="4" data-sha="${escAttr(c.sha)}"><title>${escAttr(tooltipFor(c))}</title></circle>`);
    }

    // Branch tip dots — one per branch, at its own lane. For a branch
    // that's been merged back, the dot sits at its LAST own commit
    // (end of its active line) rather than floating at the merge-back
    // timestamp — the rejoin curve shows where it went after.
    for (const tip of branchTipPositions) {
      const cat = categoryOf(tip.branch.name);
      const isHighlight = highlight === tip.branch.name;
      const cls = `phy-dot ${cat} tip${isHighlight ? ' highlight' : ''}${tip.mergedBack ? ' merged-back' : ''}`;
      dotsHtml.push(
        `<circle class="${cls}" cx="${tip.x}" cy="${tip.y}" r="6" data-sha="${escAttr(tip.commit.sha)}" data-branch="${escAttr(tip.branch.name)}"><title>${escAttr(tooltipFor(tip.commit))}</title></circle>`
      );
    }
    gDots.innerHTML = dotsHtml.join('');

    // Labels: one per branch, at that branch's lane. LOD threshold on tip
    // count — Auspice-style. Merged-back branches get a slightly muted
    // label (italic, lower opacity) so it's easy to scan for what's
    // currently active vs currently at-rest-on-main. No terminal marker —
    // a branch may sprout new commits later.
    const tipCount = branchTipPositions.length;
    const fontSize = tipCount <= 6 ? 13 : tipCount <= 15 ? 11 : tipCount <= 30 ? 10 : 0;
    const labelsHtml = [];
    if (fontSize > 0) {
      for (const tip of branchTipPositions) {
        const branch = tip.branch;
        const display = branch.isMain ? branch.name : branch.name.replace(/^(feature|auto)\//, '');
        const cat = categoryOf(branch.name);
        const isHighlight = highlight === branch.name;
        const cls = `phy-tip-label ${cat}${isHighlight ? ' highlight' : ''}${tip.mergedBack ? ' merged-back' : ''}`;
        labelsHtml.push(
          `<text class="${cls}" x="${tip.x + 10}" y="${tip.y}" dy="0.35em" font-size="${fontSize}" data-branch="${escAttr(branch.name)}">${escText(display)}</text>`
        );
      }
    }
    gLabels.innerHTML = labelsHtml.join('');
  }

  // Delegated click: dots + labels both trigger branch selection when
  // clicked on a tip.
  svg.addEventListener('click', (e) => {
    const target = e.target.closest('[data-branch]');
    if (target && onSelectBranch) onSelectBranch(target.dataset.branch);
  });

  // Hover tooltip for dots.
  svg.addEventListener('mousemove', (e) => {
    const dot = e.target.closest('.phy-dot');
    if (!dot) { tooltip.style.display = 'none'; return; }
    const sha = dot.getAttribute('data-sha');
    const c = currentData?.commits?.get(sha);
    if (!c) { tooltip.style.display = 'none'; return; }
    tooltip.style.display = 'block';
    tooltip.innerHTML = tooltipFor(c).replace(/\n/g, '<br>');
    const containerRect = container.getBoundingClientRect();
    tooltip.style.left = (e.clientX - containerRect.left + 12) + 'px';
    tooltip.style.top = (e.clientY - containerRect.top + 12) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  return {
    render(data, highlight) {
      currentData = data;
      currentHighlight = highlight;
      layoutAndPaint(data, highlight);
    },
    resize() {
      if (currentData) layoutAndPaint(currentData, currentHighlight);
    },
    destroy() {
      container.innerHTML = '';
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function categoryOf(branchName) {
  if (branchName === 'main' || branchName === 'master') return 'main';
  if (branchName.startsWith('feature/')) return 'feature';
  if (branchName.startsWith('auto/')) return 'auto';
  return 'misc';
}

function primaryRef(commit, branches) {
  // Prefer a non-main ref (so clicking a tip picks the branch, not main).
  const nonMain = [...commit.refs].find((r) => r !== 'main' && r !== 'master');
  return nonMain || [...commit.refs][0] || 'main';
}

function tooltipFor(c) {
  const age = relativeTime(c.timestamp);
  return `${c.sha.slice(0, 7)} · ${age}\n${c.message}\n${[...c.refs].join(', ')}`;
}

function relativeTime(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
