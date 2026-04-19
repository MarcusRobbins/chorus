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

  // For each non-main branch, fetch the compare payload. That gives us the
  // merge base (divergence point on main) plus every commit on the branch
  // since divergence. We also pick up the merge base commit itself so the
  // elbow has somewhere to attach.
  const tasks = branches
    .filter((b) => b.name !== mainName)
    .map(async (b) => {
      try {
        const cmp = await gh.compareCommits(token, owner, repo, mainName, b.name);
        if (cmp.merge_base_commit) addCommit(cmp.merge_base_commit, mainName);
        for (const c of cmp.commits || []) addCommit(c, b.name);
      } catch (err) {
        // Rate-limit / 404 — skip this branch's history, keep its tip visible.
        console.warn('[phylogeny] compare failed for', b.name, err?.message || err);
      }
    });
  await Promise.allSettled(tasks);

  // Always include the main tip even if we didn't pick it up via compares
  // (e.g. no feature branches exist yet).
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
  // Assign a "primary branch" to each commit: the branch this commit is
  // canonically considered to live on. A commit may have multiple refs
  // (e.g. a commit on main is also "on" every feature branch branched
  // after it). Main wins; after that, stable order of the branch list.
  const branchOrder = [
    mainName,
    ...branches.filter((b) => !b.isMain).map((b) => b.name),
  ];
  for (const c of commits.values()) {
    c.pickBranch = branchOrder.find((bn) => c.refs.has(bn)) || mainName;
  }

  // Lane assignment: main first (center), then feature branches alternating
  // above and below, then auto, then misc. Lane 0 = center; negative =
  // above, positive = below. Visual spread makes main the obvious trunk.
  const lanes = new Map();
  lanes.set(mainName, 0);
  const nonMain = branches.filter((b) => !b.isMain);
  // Alternate above / below for visual spread.
  nonMain.forEach((b, i) => {
    const sign = i % 2 === 0 ? -1 : 1;
    const offset = Math.ceil((i + 1) / 2);
    lanes.set(b.name, sign * offset);
  });

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

  return { xScale, yScale, laneCount, rowHeight };
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

    const { xScale } = computeLayout(data, { width, height });
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
    gStems.innerHTML = stemsHtml.join('');

    // Merges.
    const mergeHtml = [];
    for (const c of data.commits.values()) {
      for (const path of c.mergeEdges || []) {
        mergeHtml.push(`<path class="phy-merge" d="${path}"/>`);
      }
    }
    gMerges.innerHTML = mergeHtml.join('');

    // Dots — only for branch tips and merge commits in v1 (straight-line
    // commits stay invisible so the lane reads as a continuous line). Will
    // make every commit a dot later if needed.
    const dotsHtml = [];
    const branchTipShas = new Set(data.branches.map((b) => b.tipSha).filter(Boolean));
    for (const c of data.commits.values()) {
      const isTip = branchTipShas.has(c.sha);
      const isMerge = (c.parents?.length || 0) >= 2;
      if (!isTip && !isMerge) continue;
      const cat = categoryOf(c.pickBranch);
      const isHighlight = highlight && (c.sha === highlight || c.refs.has(highlight));
      const cls = `phy-dot ${cat}${isTip ? ' tip' : ''}${isMerge ? ' merge' : ''}${isHighlight ? ' highlight' : ''}`;
      const r = isTip ? 6 : 4;
      const dataAttrs = [
        `data-sha="${escAttr(c.sha)}"`,
        isTip ? `data-branch="${escAttr(primaryRef(c, data.branches))}"` : '',
      ].filter(Boolean).join(' ');
      dotsHtml.push(`<circle class="${cls}" cx="${c.x}" cy="${c.y}" r="${r}" ${dataAttrs}><title>${escAttr(tooltipFor(c))}</title></circle>`);
    }
    gDots.innerHTML = dotsHtml.join('');

    // Labels: branch-tip names. Auspice-style LOD — if there are many, we
    // shrink or hide. v1 threshold: always show tip names but size by count.
    const tips = [...data.commits.values()].filter((c) => branchTipShas.has(c.sha));
    const fontSize = tips.length <= 6 ? 13 : tips.length <= 15 ? 11 : tips.length <= 30 ? 10 : 0;
    const labelsHtml = [];
    if (fontSize > 0) {
      for (const c of tips) {
        const branch = data.branches.find((b) => b.tipSha === c.sha);
        if (!branch) continue;
        const display = branch.isMain ? branch.name : branch.name.replace(/^(feature|auto)\//, '');
        const cat = categoryOf(branch.name);
        const isHighlight = highlight === branch.name;
        const cls = `phy-tip-label ${cat}${isHighlight ? ' highlight' : ''}`;
        labelsHtml.push(
          `<text class="${cls}" x="${c.x + 10}" y="${c.y}" dy="0.35em" font-size="${fontSize}" data-branch="${escAttr(branch.name)}">${escText(display)}</text>`
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
