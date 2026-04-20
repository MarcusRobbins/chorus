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
import { createPhylogeny, loadPhylogenyData } from './phylogeny.js';

// ───────────────────────────────────────────────────────────────────
// Styles — defined up front so the boot path can use them without TDZ
// ───────────────────────────────────────────────────────────────────
const CSS_TEXT = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  :host {
    all: initial;
    /* Design tokens — intentionally narrow palette + tight scale. */
    --c-bg:           #ffffff;
    --c-bg-subtle:    #fafafa;
    --c-bg-muted:     #f4f4f5;
    --c-border:       #e5e7eb;
    --c-border-strong:#d4d4d8;
    --c-text:         #0a0a0a;
    --c-text-muted:   #52525b;
    --c-text-faint:   #a1a1aa;

    --c-accent:       #4f46e5;
    --c-accent-hover: #4338ca;
    --c-accent-bg:    #eef2ff;
    --c-accent-fg:    #4338ca;

    --c-success:      #059669;
    --c-success-bg:   #ecfdf5;
    --c-warning:      #d97706;
    --c-warning-bg:   #fffbeb;
    --c-danger:       #dc2626;
    --c-danger-bg:    #fef2f2;

    --r-xs: 4px;
    --r-sm: 6px;
    --r-md: 10px;
    --r-lg: 14px;
    --r-xl: 20px;

    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 8px -2px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.04);
    --shadow-lg: 0 24px 48px -12px rgba(0,0,0,0.14), 0 4px 8px -4px rgba(0,0,0,0.04);
    --shadow-xl: 0 32px 64px -16px rgba(0,0,0,0.20), 0 12px 24px -8px rgba(0,0,0,0.06);

    --t-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1);
    --t-med:  220ms cubic-bezier(0.4, 0, 0.2, 1);
    --t-spring: 280ms cubic-bezier(0.34, 1.3, 0.64, 1);

    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    --grad-primary: linear-gradient(180deg, #1a1a1e 0%, #0a0a0a 100%);
    --grad-accent:  linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
  }
  * {
    box-sizing: border-box;
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  /* Custom scrollbars — subtle, don't fight the design. */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--c-text-faint) 50%, transparent);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--c-text-muted) 60%, transparent);
    background-clip: content-box;
  }
  /* Selection colour — indigo with low alpha. */
  ::selection { background: color-mix(in srgb, var(--c-accent) 25%, transparent); }

  /* ── Trigger pill (collapsed) ────────────────────────────── */
  .trigger {
    position: fixed; bottom: 20px; right: 20px;
    display: inline-flex; align-items: center; gap: 10px;
    padding: 10px 16px 10px 13px; border-radius: 999px;
    background: var(--grad-primary);
    color: var(--c-bg); border: none;
    box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.08);
    font-size: 13px; font-weight: 500; letter-spacing: -0.005em;
    cursor: pointer; pointer-events: auto;
    transition: transform var(--t-spring), box-shadow var(--t-med);
    max-width: 340px;
  }
  .trigger:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-xl), inset 0 1px 0 rgba(255,255,255,0.1);
  }
  .trigger:active { transform: translateY(0); transition-duration: 80ms; }
  .trigger .dot {
    width: 8px; height: 8px; border-radius: 999px;
    background: var(--c-text-faint); flex-shrink: 0;
    transition: background var(--t-fast), box-shadow var(--t-fast);
    position: relative;
  }
  .trigger .dot.authed {
    background: var(--c-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-success) 25%, transparent);
  }
  .trigger .dot.working {
    background: var(--c-warning);
    animation: working-pulse 1.6s ease-in-out infinite;
  }
  .trigger .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
  @keyframes working-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--c-warning) 0%, transparent);
    }
    50% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--c-warning) 30%, transparent);
    }
  }

  /* ── Panel shell ─────────────────────────────────────────── */
  .panel {
    position: fixed; bottom: 20px; right: 20px;
    width: 420px; max-height: 82vh;
    background: var(--c-bg); color: var(--c-text);
    border-radius: var(--r-lg); border: 1px solid var(--c-border);
    box-shadow: var(--shadow-xl);
    display: flex; flex-direction: column;
    pointer-events: auto;
    overflow: hidden;
    transition: top var(--t-med), bottom var(--t-med), width var(--t-med), max-height var(--t-med);
  }
  .panel.with-phylogeny {
    top: 24px;
    right: 24px;
    bottom: calc(100vh - 24px - var(--chorus-top-height, 66vh));
    width: var(--chorus-panel-width, 420px);
    max-height: none;
    max-width: none;
  }

  /* ── Header ──────────────────────────────────────────────── */
  .header {
    display: flex; align-items: center; gap: 6px;
    padding: 12px 14px 12px 16px;
    background: linear-gradient(180deg, var(--c-bg) 0%, var(--c-bg-subtle) 100%);
    border-bottom: 1px solid var(--c-border);
    flex-shrink: 0;
    position: relative;
  }
  /* Hairline accent under header — subtle, adds weight without a bar. */
  .header::after {
    content: '';
    position: absolute; left: 16px; right: 16px; bottom: -1px;
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      color-mix(in srgb, var(--c-accent) 30%, transparent) 50%,
      transparent 100%);
    pointer-events: none;
  }
  .header .back, .header .close, .header .menu-btn {
    border: none; background: transparent; cursor: pointer;
    font-size: 15px; color: var(--c-text-muted);
    width: 26px; height: 26px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--r-sm);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .header .back:hover, .header .close:hover, .header .menu-btn:hover {
    background: var(--c-bg-muted); color: var(--c-text);
  }

  /* Settings modal — overlay on top of the panel, click backdrop to close */
  .settings-backdrop {
    position: fixed; inset: 0;
    background: rgba(10, 10, 10, 0.36);
    backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
    z-index: 2147483647;
    animation: settings-fade var(--t-med);
  }
  @keyframes settings-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .settings-modal {
    width: min(460px, calc(100vw - 40px));
    max-height: calc(100vh - 80px);
    background: var(--c-bg);
    color: var(--c-text);
    border-radius: var(--r-lg);
    border: 1px solid var(--c-border);
    box-shadow: var(--shadow-xl);
    display: flex; flex-direction: column;
    overflow: hidden;
    animation: settings-rise var(--t-spring);
  }
  @keyframes settings-rise {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .settings-modal > .body { padding: 16px; gap: 14px; }

  /* Header overflow menu dropdown */
  .menu-wrap { position: relative; }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 200px;
    padding: 6px;
    background: var(--c-bg);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-xl);
    z-index: 20;
    display: flex; flex-direction: column;
  }
  .menu-section-label {
    padding: 6px 10px 4px;
    font-size: 10px; font-weight: 600;
    color: var(--c-text-faint);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .menu-item {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 10px; border-radius: var(--r-sm);
    border: none; background: transparent; cursor: pointer;
    font: inherit; font-size: 12.5px; color: var(--c-text);
    text-align: left; width: 100%;
    transition: background var(--t-fast);
  }
  .menu-item:hover { background: var(--c-bg-muted); }
  .menu-item.checked { color: var(--c-accent); font-weight: 500; }
  .menu-item .menu-check {
    width: 14px; flex-shrink: 0;
    display: inline-flex; justify-content: center;
    color: var(--c-accent); font-weight: 600;
    font-size: 12px;
  }
  .menu-divider {
    height: 1px; background: var(--c-border);
    margin: 4px 2px;
  }
  .menu-identity {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px 4px;
    font-size: 11px; color: var(--c-text-muted);
  }
  .menu-identity img {
    width: 18px; height: 18px; border-radius: 999px;
    border: 1px solid var(--c-border);
    flex-shrink: 0;
  }
  .menu-identity strong { color: var(--c-text); font-weight: 500; }
  .header .back[hidden] { display: none; }
  .header .title {
    flex: 1; font-size: 13px; font-weight: 600; letter-spacing: -0.01em;
    color: var(--c-text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .header .title code {
    font-family: var(--font-mono); font-size: 12px; font-weight: 500;
    color: var(--c-text-muted); background: var(--c-bg-muted);
    padding: 2px 7px; border-radius: var(--r-sm);
  }

  /* ── Body (scrollable) ───────────────────────────────────── */
  .body {
    flex: 1; overflow: auto;
    padding: 14px;
    display: flex; flex-direction: column; gap: 12px;
    font-size: 13px; line-height: 1.5;
  }
  .body p { margin: 0; color: var(--c-text); }
  .body .muted { color: var(--c-text-muted); font-size: 12px; }
  .body .muted-s { color: var(--c-text-faint); font-size: 11px; }
  .body .err {
    padding: 10px 12px; background: var(--c-danger-bg);
    border: 1px solid color-mix(in srgb, var(--c-danger) 25%, transparent);
    color: var(--c-danger); border-radius: var(--r-md);
    font-size: 12px; line-height: 1.45;
  }
  .body .ok {
    padding: 10px 12px; background: var(--c-success-bg);
    border: 1px solid color-mix(in srgb, var(--c-success) 25%, transparent);
    color: var(--c-success); border-radius: var(--r-md);
    font-size: 12px; line-height: 1.45;
  }
  .body code {
    font-family: var(--font-mono); font-size: 12px;
    background: var(--c-bg-muted); color: var(--c-text);
    padding: 1.5px 5px; border-radius: var(--r-xs);
  }

  /* ── Action bar ──────────────────────────────────────────── */
  .action-bar {
    padding: 12px 14px;
    border-top: 1px solid var(--c-border);
    background: var(--c-bg-subtle);
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    flex-shrink: 0;
  }
  .action-bar .secondary { display: flex; gap: 6px; flex-wrap: wrap; }
  .action-bar .secondary button {
    background: var(--c-bg); border: 1px solid var(--c-border); color: var(--c-text);
    font: inherit; font-size: 12px; font-weight: 500;
    cursor: pointer;
    padding: 6px 12px; border-radius: var(--r-sm);
    box-shadow: var(--shadow-sm);
    transition: background var(--t-fast), border-color var(--t-fast),
                transform var(--t-fast), box-shadow var(--t-fast);
  }
  .action-bar .secondary button:hover {
    background: var(--c-bg-subtle); border-color: var(--c-border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
  .action-bar .secondary button:active {
    transform: translateY(0); box-shadow: var(--shadow-sm);
  }
  .action-bar .primary {
    font: inherit; font-size: 13px; font-weight: 500;
    letter-spacing: -0.005em;
    padding: 8px 18px; border-radius: var(--r-sm);
    cursor: pointer;
    background: var(--grad-primary); color: var(--c-bg);
    border: 1px solid var(--c-text);
    box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.08);
    transition: transform var(--t-fast), box-shadow var(--t-fast);
  }
  .action-bar .primary:hover:not(:disabled) {
    box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,0.12);
    transform: translateY(-1px);
  }
  .action-bar .primary:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .action-bar .primary:disabled {
    background: var(--c-bg-muted); color: var(--c-text-faint);
    border-color: var(--c-border); box-shadow: none;
    cursor: default;
  }
  .action-bar .primary.green {
    background: linear-gradient(180deg, #10b981 0%, #059669 100%);
    border-color: #047857; color: var(--c-bg);
  }
  .action-bar .primary.green:hover:not(:disabled) {
    background: linear-gradient(180deg, #059669 0%, #047857 100%);
  }

  /* ── Form controls ───────────────────────────────────────── */
  label.field {
    display: flex; flex-direction: column; gap: 6px;
    font-size: 12px; font-weight: 500; color: var(--c-text-muted);
  }
  label.field input, label.field textarea, label.field select {
    font: inherit; font-size: 13px; font-weight: 400;
    padding: 8px 10px;
    border: 1px solid var(--c-border); border-radius: var(--r-sm);
    color: var(--c-text); background: var(--c-bg);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  label.field input::placeholder, label.field textarea::placeholder {
    color: var(--c-text-faint);
  }
  label.field input:focus, label.field textarea:focus, label.field select:focus {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-accent) 15%, transparent);
  }
  label.field textarea { min-height: 72px; resize: vertical; line-height: 1.5; }
  input[type="password"].key-input {
    font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.05em;
  }

  /* ── Branch list ─────────────────────────────────────────── */
  .branch-list { display: flex; flex-direction: column; gap: 1px; }
  .branch {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 10px; border-radius: var(--r-sm); cursor: pointer;
    transition: background var(--t-fast);
  }
  .branch:hover { background: var(--c-bg-muted); }
  .branch.active {
    background: var(--c-accent-bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 25%, transparent);
  }
  .branch .name {
    flex: 1; font-family: var(--font-mono); font-size: 12px; font-weight: 500;
    color: var(--c-text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .branch .sha {
    font-family: var(--font-mono); font-size: 11px; color: var(--c-text-faint);
  }
  .branch .marker {
    font-size: 9.5px; padding: 2px 7px; border-radius: var(--r-xs);
    text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em;
    line-height: 1.4;
  }
  .branch .marker.main { background: var(--c-text); color: var(--c-bg); }
  .branch .marker.feature { background: var(--c-accent-bg); color: var(--c-accent-fg); }
  .branch .marker.auto { background: var(--c-warning-bg); color: var(--c-warning); }
  .section-heading {
    font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--c-text-faint);
    margin: 10px 0 4px;
  }

  /* In-panel tree-view intro card (phylogeny itself is in the band) */
  .tree-hint {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 14px;
    background: linear-gradient(135deg,
      var(--c-accent-bg) 0%,
      color-mix(in srgb, var(--c-accent-bg) 50%, var(--c-bg)) 100%);
    border: 1px solid color-mix(in srgb, var(--c-accent) 20%, transparent);
    border-radius: var(--r-md);
  }
  .tree-hint-mark {
    width: 18px; height: 18px; border-radius: 999px;
    background: var(--grad-accent);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18),
                0 0 0 3px color-mix(in srgb, var(--c-accent) 15%, transparent);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .tree-hint-title {
    font-weight: 600; color: var(--c-accent-fg);
    font-size: 13px; margin-bottom: 2px;
    letter-spacing: -0.01em;
  }

  /* Phylogeny tree (legacy in-panel version; unused in tree mode now
     that the phylogeny lives in the band, but kept for reference if we
     want to re-introduce a mini-map inside the panel later.) */
  .tree {
    position: relative;
    padding: 8px 4px 8px 32px;
    font-size: 13px;
  }
  .tree-trunk {
    position: absolute;
    left: 18px; top: 24px; bottom: 24px;
    width: 2px; background: #ddd;
    border-radius: 1px;
  }
  .tree-node {
    position: relative;
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; margin: 4px 0;
    border-radius: 6px; cursor: pointer;
    transition: background .1s ease;
  }
  .tree-node:hover { background: #f4f4f4; }
  .tree-node.active { background: #eef4ff; border: 1px solid #cfe2ff; padding: 7px 9px; }
  .tree-node.root { cursor: default; }
  .tree-node.root:hover { background: transparent; }
  .tree-node .connector {
    position: absolute;
    left: -14px; top: 50%;
    width: 14px; height: 2px;
    background: #ddd;
  }
  .tree-node.root .connector { display: none; }
  .tree-node .dot {
    width: 10px; height: 10px; border-radius: 5px;
    background: #888; flex-shrink: 0;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1.5px #888;
  }
  .tree-node.root .dot { background: #111; box-shadow: 0 0 0 1.5px #111; width: 12px; height: 12px; }
  .tree-node.feature .dot { background: #0366d6; box-shadow: 0 0 0 1.5px #0366d6; }
  .tree-node.auto .dot { background: #e8a030; box-shadow: 0 0 0 1.5px #e8a030; }
  .tree-node .label {
    flex: 1;
    display: flex; flex-direction: column; gap: 2px;
    overflow: hidden;
  }
  .tree-node .label .name {
    font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tree-node .label .meta {
    font-size: 11px; color: #888;
  }
  .tree-node .sha {
    font-family: ui-monospace, monospace;
    font-size: 10px; color: #999;
    flex-shrink: 0;
  }
  .tree-section-heading {
    font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
    color: #aaa; margin: 10px 0 0 0; padding: 0 10px;
  }
  .tree-sprout {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; margin: 8px 0 4px;
    border-radius: 6px; cursor: pointer;
    color: #0366d6; font-size: 12px;
    border: 1px dashed #cfe2ff; background: transparent;
    transition: background .1s ease;
  }
  .tree-sprout:hover { background: #f0f6ff; }
  .tree-sprout .connector {
    position: absolute; left: -14px; top: 50%;
    width: 14px; height: 2px; background: #cfe2ff;
  }

  /* Phylogeny — floating horizontal band under the iframe */
  .phylogeny-host {
    position: fixed;
    top: calc(24px + var(--chorus-top-height, 66vh) + var(--chorus-pane-gap, 12px));
    left: 24px;
    right: 24px;
    bottom: 24px;
    background: rgba(255,255,255,0.96);
    border: 1px solid var(--c-border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-xl);
    pointer-events: auto;
    overflow: hidden;
    display: none;
    min-height: 140px;
    backdrop-filter: blur(8px);
  }

  /* Horizontal resize handle centred in the gap between top row and
     phylogeny. Hit target spans most of the gap; the visible indicator
     (a 2px bar) is a thinner line inside it that glows on hover/drag. */
  .chorus-resize-h {
    position: fixed;
    top: calc(24px + var(--chorus-top-height, 66vh));
    left: 24px;
    right: 24px;
    height: var(--chorus-pane-gap, 12px);
    cursor: row-resize;
    pointer-events: auto;
    z-index: 2147483641;
    display: none;
  }
  .chorus-resize-h.active { display: block; }
  .chorus-resize-h::after {
    content: '';
    position: absolute;
    top: calc(50% - 1px); left: 20%; right: 20%; height: 2px;
    background: transparent;
    border-radius: 1px;
    transition: background .12s ease;
  }
  .chorus-resize-h:hover::after,
  .chorus-resize-h.dragging::after {
    background: var(--c-accent);
  }

  /* Vertical resize handle centred in the gap between iframe and panel. */
  .chorus-resize-v {
    position: fixed;
    top: 24px;
    bottom: calc(100vh - 24px - var(--chorus-top-height, 66vh));
    right: calc(24px + var(--chorus-panel-width, 420px));
    width: var(--chorus-pane-gap, 12px);
    cursor: col-resize;
    pointer-events: auto;
    z-index: 2147483641;
    display: none;
  }
  .chorus-resize-v.active { display: block; }
  .chorus-resize-v::after {
    content: '';
    position: absolute;
    left: calc(50% - 1px); top: 20%; bottom: 20%; width: 2px;
    background: transparent;
    border-radius: 1px;
    transition: background var(--t-fast);
  }
  .chorus-resize-v:hover::after,
  .chorus-resize-v.dragging::after {
    background: var(--c-accent);
  }
  .phylogeny-host.active { display: block; }
  .phylogeny-header {
    position: absolute; top: 0; left: 0; right: 0;
    padding: 10px 14px; display: flex; align-items: center; gap: 10px;
    font-size: 11px; color: var(--c-text-muted);
    font-family: var(--font-sans);
    border-bottom: 1px solid var(--c-border);
    background: linear-gradient(180deg, var(--c-bg) 0%, var(--c-bg-subtle) 100%);
    z-index: 2;
    position: absolute;
  }
  /* Hairline indigo accent under phylogeny header — matches panel. */
  .phylogeny-header::after {
    content: '';
    position: absolute; left: 14px; right: 14px; bottom: -1px;
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      color-mix(in srgb, var(--c-accent) 30%, transparent) 50%,
      transparent 100%);
    pointer-events: none;
  }
  .phylogeny-header .mark {
    width: 16px; height: 16px; border-radius: 999px;
    background: var(--grad-accent);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15),
                0 0 0 2px color-mix(in srgb, var(--c-accent) 15%, transparent);
    flex-shrink: 0;
  }
  .phylogeny-header .title {
    font-weight: 600; color: var(--c-text);
    font-size: 12px; letter-spacing: -0.01em;
  }
  .phylogeny-header .count {
    color: var(--c-text-faint); font-family: var(--font-mono); font-size: 10.5px;
    padding: 2px 7px; border-radius: var(--r-xs);
    background: var(--c-bg-muted);
  }
  .phylogeny-header .loading {
    color: var(--c-accent); font-style: italic;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .phylogeny-header .loading::before {
    content: ''; width: 8px; height: 8px; border-radius: 999px;
    background: var(--c-accent);
    animation: working-pulse 1.4s ease-in-out infinite;
  }
  .phylogeny-header .phy-reset {
    margin-left: auto;
    border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text);
    font: inherit; font-size: 11px; font-weight: 500;
    padding: 4px 10px; border-radius: var(--r-sm); cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: background var(--t-fast), border-color var(--t-fast),
                transform var(--t-fast), box-shadow var(--t-fast);
  }
  .phylogeny-header .phy-reset:hover {
    background: var(--c-bg-subtle); border-color: var(--c-border-strong);
    transform: translateY(-1px); box-shadow: var(--shadow-md);
  }
  .phylogeny-body {
    position: absolute; top: 40px; left: 0; right: 0; bottom: 0;
  }
  .phy-tooltip {
    position: absolute;
    padding: 8px 10px;
    background: var(--c-text); color: var(--c-bg);
    font-size: 11px; line-height: 1.5;
    border-radius: var(--r-sm);
    pointer-events: none;
    white-space: pre-wrap;
    max-width: 300px;
    z-index: 10;
    font-family: var(--font-sans);
    box-shadow: var(--shadow-md);
  }
  .phylogeny-svg text {
    pointer-events: auto; cursor: pointer; user-select: none;
    font-family: var(--font-sans);
  }

  .phy-stem { fill: none; stroke: var(--c-text-faint); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .phy-stem.main { stroke: var(--c-text); stroke-width: 2.5; }
  .phy-stem.feature { stroke: var(--c-accent); }
  .phy-stem.auto { stroke: var(--c-warning); }
  .phy-stem.misc { stroke: var(--c-text-faint); }

  .phy-merge { fill: none; stroke: var(--c-text-faint); stroke-width: 1.5; stroke-dasharray: 3,3; opacity: 0.7; }

  /* Rejoin: right-angle elbow from branch's last own commit back down into
     main at the merge commit. Matches the stem style (same stroke-width,
     same linejoin) so it reads as a continuous flow. */
  .phy-rejoin {
    fill: none; stroke-width: 2; opacity: 0.85;
    stroke-linecap: round; stroke-linejoin: round;
  }
  .phy-rejoin.feature { stroke: var(--c-accent); }
  .phy-rejoin.auto { stroke: var(--c-warning); }
  .phy-rejoin.misc { stroke: var(--c-text-faint); }

  /* Pointer: fallback dashed stub for branches that have no own commits. */
  .phy-pointer { fill: none; stroke-width: 1.5; stroke-dasharray: 2,3; opacity: 0.5; }
  .phy-pointer.feature { stroke: var(--c-accent); }
  .phy-pointer.auto { stroke: var(--c-warning); }
  .phy-pointer.misc { stroke: var(--c-text-faint); }

  .phy-dot { cursor: pointer; stroke: #fff; stroke-width: 2; transition: r var(--t-fast); }
  .phy-dot.main { fill: var(--c-text); }
  .phy-dot.feature { fill: var(--c-accent); }
  .phy-dot.auto { fill: var(--c-warning); }
  .phy-dot.misc { fill: var(--c-text-faint); }
  .phy-dot.merge { stroke-dasharray: 2,2; }
  .phy-dot.merged-back { opacity: 0.7; }
  .phy-dot:hover { r: 8; }
  .phy-dot.highlight {
    stroke: var(--c-text); stroke-width: 3;
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c-accent) 50%, transparent));
  }

  .phy-tip-label { fill: var(--c-text); font-weight: 500; font-size: 11px; letter-spacing: -0.005em; }
  .phy-tip-label.main { fill: var(--c-text); font-weight: 600; }
  .phy-tip-label.feature { fill: var(--c-accent); }
  .phy-tip-label.auto { fill: var(--c-warning); }
  .phy-tip-label.misc { fill: var(--c-text-muted); }
  .phy-tip-label.highlight { font-weight: 700; text-decoration: underline; }
  .phy-tip-label.merged-back { opacity: 0.6; font-style: italic; }
  .phy-tip-label:hover { fill: var(--c-text); text-decoration: underline; }


  /* AI session model picker — compact variant of label.field. */
  .ai-model-picker {
    flex-direction: row; align-items: center; gap: 8px;
    font-size: 11px; color: var(--c-text-faint);
    padding: 6px 10px;
    background: var(--c-bg-subtle);
    border: 1px solid var(--c-border);
    border-radius: var(--r-sm);
  }
  .ai-model-picker select {
    flex: 1; margin-left: auto;
    padding: 3px 6px; font-size: 12px;
    min-width: 120px;
  }

  /* Skeleton loader — shimmer effect for loading states. */
  .skeleton {
    background: linear-gradient(90deg,
      var(--c-bg-muted) 0%,
      color-mix(in srgb, var(--c-bg-muted) 50%, var(--c-bg)) 50%,
      var(--c-bg-muted) 100%);
    background-size: 200% 100%;
    border-radius: var(--r-sm);
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }
  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Nav card (used in browse to link into sub-sections) ──── */
  .nav-card {
    display: flex; align-items: center; gap: 12px;
    width: 100%; padding: 12px 14px; border-radius: var(--r-md);
    background: var(--c-bg); border: 1px solid var(--c-border);
    box-shadow: var(--shadow-sm);
    cursor: pointer; font: inherit; text-align: left;
    transition: background var(--t-fast), border-color var(--t-fast),
                transform var(--t-fast), box-shadow var(--t-fast);
  }
  .nav-card:hover {
    background: var(--c-bg-subtle);
    border-color: var(--c-border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
  .nav-card-mark {
    width: 14px; height: 14px; border-radius: 999px;
    background: var(--grad-accent);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15),
                0 0 0 3px color-mix(in srgb, var(--c-accent) 12%, transparent);
    flex-shrink: 0;
  }
  .nav-card-title {
    font-size: 13px; font-weight: 600; color: var(--c-text);
    letter-spacing: -0.01em; margin-bottom: 2px;
  }
  .nav-card-chev {
    margin-left: auto; color: var(--c-text-faint);
    font-size: 14px; font-weight: 500;
    transition: color var(--t-fast), transform var(--t-fast);
  }
  .nav-card:hover .nav-card-chev { color: var(--c-accent); transform: translateX(2px); }

  /* ── Thread list ──────────────────────────────────────────── */
  .thread-list { display: flex; flex-direction: column; gap: 8px; }
  .thread-item {
    width: 100%; text-align: left; font: inherit;
    display: flex; flex-direction: column; gap: 4px;
    padding: 10px 12px; border-radius: var(--r-md);
    background: var(--c-bg); border: 1px solid var(--c-border);
    cursor: pointer;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .thread-item:hover {
    border-color: var(--c-border-strong);
    box-shadow: var(--shadow-sm);
  }
  .thread-item-head {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; color: var(--c-text-muted);
  }
  .thread-item-head .thread-num {
    font-family: var(--font-mono); font-size: 10.5px;
    color: var(--c-text-faint);
  }
  .thread-item-head .thread-el {
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-mono); font-size: 11px;
    color: var(--c-text-muted);
  }
  .thread-item-head .thread-age { font-size: 10.5px; color: var(--c-text-faint); }
  .thread-item-body {
    font-size: 13px; font-weight: 500; color: var(--c-text);
    letter-spacing: -0.005em; line-height: 1.4;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .thread-item-meta { font-size: 11px; }

  /* Pin card — shared between propose screen and thread view. Filled
     (a real element pinned) gets the accent colour; empty gets a muted
     surface. Always a flex row: dot + info + actions. */
  .pin-card {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--c-accent-bg);
    border: 1px solid color-mix(in srgb, var(--c-accent) 20%, transparent);
  }
  .pin-card.empty {
    background: var(--c-bg-subtle);
    border-color: var(--c-border);
  }
  .pin-card-dot {
    width: 12px; height: 12px; border-radius: 999px;
    background: var(--c-bg-muted);
    box-shadow: inset 0 0 0 1px var(--c-border);
    flex-shrink: 0; margin-top: 3px;
  }
  .pin-card-dot.filled {
    background: var(--grad-accent);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2),
                0 0 0 3px color-mix(in srgb, var(--c-accent) 15%, transparent);
  }
  .pin-card-info {
    flex: 1 1 auto; min-width: 0;
    font-family: var(--font-mono); font-size: 12px;
    color: var(--c-accent-fg);
    word-break: break-all;
    line-height: 1.5;
  }
  .pin-card.empty .pin-card-info {
    font-family: var(--font-sans);
    color: var(--c-text-muted);
    font-style: italic;
  }
  .pin-card-el {
    font-family: var(--font-mono); font-size: 12px; color: var(--c-accent-fg);
    word-break: break-all;
  }
  .pin-card-el.empty {
    font-family: var(--font-sans);
    color: var(--c-text-muted);
    font-style: italic;
  }
  .pin-card-actions {
    display: flex; gap: 4px; flex-shrink: 0;
    align-items: center;
  }

  /* Reddit-style thread view — OP card on top, vote column down the left,
     comments underneath with their own vote columns, reply composer at
     the bottom. Designed to be instantly familiar to anyone who has ever
     used reddit. */
  .reddit-op {
    display: flex; gap: 10px;
    padding: 12px 14px;
    background: var(--c-bg);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    margin-bottom: 10px;
  }
  .op-main {
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .op-meta {
    display: flex; align-items: center; gap: 6px;
    font-size: 11.5px; color: var(--c-text-faint);
    flex-wrap: wrap;
  }
  .op-feature {
    color: var(--c-accent); font-weight: 600;
    font-family: var(--font-mono); font-size: 11.5px;
  }
  .op-sep { opacity: 0.5; }
  .op-author {
    display: inline-flex; align-items: center; gap: 5px;
    color: var(--c-text-muted); font-weight: 500;
  }
  .op-author img {
    width: 14px; height: 14px; border-radius: 999px;
    border: 1px solid var(--c-border);
  }
  .op-age { color: var(--c-text-faint); }
  .op-resolved {
    color: var(--c-text-faint); font-style: italic;
  }
  .op-title {
    font-size: 15px; font-weight: 600; color: var(--c-text);
    line-height: 1.3; margin: 2px 0 0;
    letter-spacing: -0.01em;
  }
  .op-body {
    font-size: 13px; color: var(--c-text);
    line-height: 1.55;
    white-space: pre-wrap; word-break: break-word;
  }
  .op-actions {
    display: flex; align-items: center; gap: 12px;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--c-border);
  }
  .op-stat {
    font-size: 11.5px; color: var(--c-text-muted);
    display: inline-flex; align-items: center; gap: 4px;
  }
  .op-stat.link { text-decoration: none; }
  .op-stat.link:hover { color: var(--c-accent); }
  .op-resolve { margin-left: auto; }

  /* Compact pin-card when rendered inside the OP */
  .pin-card.compact {
    padding: 6px 8px;
    font-size: 11px;
  }
  .pin-card.compact .pin-card-info {
    font-size: 11px; line-height: 1.4;
  }
  .pin-card-page { color: var(--c-text-faint); font-family: var(--font-mono); }

  /* Vote column: vertical stack of ▲ / score / ▼ */
  .vote-col {
    display: flex; flex-direction: column; align-items: center;
    gap: 2px; flex-shrink: 0; padding-top: 1px;
  }
  .vote-btn {
    background: transparent; border: none; cursor: pointer;
    width: 24px; height: 20px;
    color: var(--c-text-faint);
    font-size: 11px; line-height: 1;
    border-radius: var(--r-xs);
    transition: background var(--t-fast), color var(--t-fast);
    display: flex; align-items: center; justify-content: center;
  }
  .vote-btn:hover:not(:disabled) { background: var(--c-bg-muted); }
  .vote-btn.up:hover:not(:disabled) { color: #ef4444; }
  .vote-btn.down:hover:not(:disabled) { color: #0ea5e9; }
  .vote-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .vote-score {
    font-size: 12px; font-weight: 600; color: var(--c-text);
    min-width: 22px; text-align: center;
  }

  /* Comments header strip */
  .comments-header {
    display: flex; align-items: baseline; gap: 12px;
    margin: 10px 0 4px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--c-border);
  }
  .comments-count {
    font-size: 12.5px; font-weight: 600; color: var(--c-text);
  }
  .comments-sort strong { color: var(--c-text); font-weight: 600; }

  /* Comments list */
  .comments-section {
    display: flex; flex-direction: column; gap: 2px;
  }
  .reddit-comment {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 8px 6px;
    border-radius: var(--r-sm);
    transition: background var(--t-fast);
  }
  .reddit-comment:hover { background: var(--c-bg-subtle); }
  .comment-main {
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: column; gap: 3px;
  }
  .comment-hdr {
    display: flex; align-items: center; gap: 6px;
    font-size: 11.5px;
  }
  .comment-hdr img {
    width: 16px; height: 16px; border-radius: 999px;
    border: 1px solid var(--c-border);
  }
  .comment-hdr .name { font-weight: 600; color: var(--c-text); }
  .comment-hdr .age { color: var(--c-text-faint); }
  .comment-body {
    font-size: 12.5px; line-height: 1.55; color: var(--c-text);
    white-space: pre-wrap; word-break: break-word;
  }

  .reply-composer {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--c-border);
  }

  /* Features (subreddit-style topic scopes) */
  .features-toolbar {
    display: flex; gap: 8px; margin: 4px 0 12px;
  }
  .features-search {
    flex: 1 1 auto;
    font: inherit; font-size: 12.5px;
    padding: 8px 12px;
    border: 1px solid var(--c-border);
    border-radius: var(--r-sm);
    background: var(--c-bg);
    color: var(--c-text);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .features-search:focus {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-bg);
  }
  .features-search::placeholder { color: var(--c-text-faint); }
  .features-search:disabled { opacity: 0.55; cursor: not-allowed; }

  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
  }
  .feature-card {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    background: var(--c-bg);
    cursor: pointer;
    text-align: left;
    font: inherit; color: inherit;
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast), background var(--t-fast);
  }
  .feature-card:hover {
    border-color: var(--c-accent);
    background: var(--c-bg-subtle);
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
  }
  .feature-card:active { transform: translateY(0); }
  .feature-card-head {
    display: flex; align-items: center; gap: 8px;
    min-width: 0;
  }
  .feature-swatch {
    flex: 0 0 auto;
    width: 10px; height: 10px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
  }
  .feature-name {
    font-family: var(--font-mono);
    font-size: 12.5px; font-weight: 600;
    color: var(--c-text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .feature-card-desc {
    font-size: 11.5px; color: var(--c-text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 32px;
  }

  /* Create form (inline on the features screen) */
  .features-create {
    display: flex; flex-direction: column; gap: 10px;
    padding: 14px 14px 12px;
    border: 1px solid var(--c-accent-border, var(--c-border));
    border-radius: var(--r-md);
    background: var(--c-bg-subtle);
    margin-bottom: 12px;
    box-shadow: var(--shadow-sm);
  }
  .features-create-head {
    display: flex; align-items: center; justify-content: space-between;
  }
  .features-create-title {
    font-size: 12.5px; font-weight: 600; color: var(--c-text);
    letter-spacing: -0.01em;
  }
  .features-create-close {
    background: transparent; border: none; cursor: pointer;
    color: var(--c-text-faint); font: inherit; font-size: 14px;
    padding: 2px 6px; border-radius: var(--r-xs);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .features-create-close:hover { background: var(--c-bg-muted); color: var(--c-text); }
  .features-create-actions {
    display: flex; gap: 8px; justify-content: flex-end;
    margin-top: 2px;
  }

  /* Feature detail page header */
  .feature-header {
    display: flex; flex-direction: column; gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    background: var(--c-bg-subtle);
    margin-bottom: 10px;
  }
  .feature-header-row {
    display: flex; align-items: center; gap: 10px;
  }
  .feature-swatch.lg {
    width: 14px; height: 14px;
  }
  .feature-name-lg {
    font-family: var(--font-mono);
    font-size: 14px; font-weight: 600;
    color: var(--c-text);
    letter-spacing: -0.01em;
  }
  .feature-header-desc {
    font-size: 12px; color: var(--c-text-muted);
    line-height: 1.5;
  }

  /* Empty state card */
  .empty-state {
    padding: 20px 18px; text-align: left;
    border: 1px dashed var(--c-border);
    border-radius: var(--r-md);
    background: var(--c-bg-subtle);
  }
  .empty-state-title {
    font-size: 13px; font-weight: 600; color: var(--c-text);
    letter-spacing: -0.01em; margin-bottom: 4px;
  }

  /* Inline link-style buttons (used in header strips etc.) */
  .link-btn {
    background: transparent; border: none; cursor: pointer;
    color: var(--c-accent); font: inherit; font-size: 11px; font-weight: 500;
    padding: 2px 4px; border-radius: var(--r-xs);
    transition: background var(--t-fast);
  }
  .link-btn:hover { background: var(--c-accent-bg); }
  .link-btn.sm { font-size: 10.5px; }

  /* Capture card — selected-element preview */
  .capture {
    padding: 10px 12px; border-radius: var(--r-sm);
    font-family: var(--font-mono); font-size: 11px;
    background: var(--c-bg-muted); color: var(--c-text-muted);
    border: 1px solid var(--c-border);
    word-break: break-all;
    max-height: 72px; overflow: auto;
    line-height: 1.5;
  }
  .capture.empty {
    color: var(--c-text-faint); font-style: italic;
    font-family: var(--font-sans);
  }

  /* AI log */
  .log {
    font-family: var(--font-mono); font-size: 11px; line-height: 1.55;
    padding: 10px 12px;
    background: var(--c-bg-subtle);
    border: 1px solid var(--c-border);
    border-radius: var(--r-sm);
    max-height: 220px; overflow: auto;
    display: flex; flex-direction: column; gap: 3px;
  }
  .log-line { white-space: pre-wrap; word-break: break-word; }
  .log-line.muted { color: var(--c-text-faint); }

  /* Device-flow code */
  .device-code {
    font-family: var(--font-mono); font-size: 22px; font-weight: 600;
    padding: 16px; background: var(--c-text); color: var(--c-bg);
    border-radius: var(--r-md);
    text-align: center; letter-spacing: 0.2em; user-select: all;
  }

  /* Who strip */
  .who {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--c-text-muted);
  }
  .who img { width: 20px; height: 20px; border-radius: 999px; border: 1px solid var(--c-border); }

  /* Issue block */
  .issue {
    border: 1px solid var(--c-border); border-radius: var(--r-md);
    padding: 12px; background: var(--c-bg);
    display: flex; flex-direction: column; gap: 8px;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .issue:hover { border-color: var(--c-border-strong); box-shadow: var(--shadow-sm); }
  .issue-hdr { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .issue-hdr .n { color: var(--c-text-faint); font-family: var(--font-mono); font-size: 11px; }
  .issue-hdr .t {
    font-weight: 600; flex: 1; letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis;
  }
  .issue-hdr .st {
    font-size: 10px; padding: 2px 7px; border-radius: var(--r-xs);
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .issue-hdr .st.open { background: var(--c-success-bg); color: var(--c-success); }
  .issue-hdr .st.closed { background: var(--c-bg-muted); color: var(--c-text-muted); }
  .issue-body {
    padding: 8px 10px; border-radius: var(--r-sm);
    background: var(--c-bg-subtle); border: 1px solid var(--c-border);
    font-size: 11px; line-height: 1.55; color: var(--c-text);
    max-height: 88px; overflow: auto;
    white-space: pre-wrap; word-break: break-word;
  }
  .issue-actions { display: flex; gap: 8px; align-items: center; font-size: 11px; }
  .vote {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--c-bg); border: 1px solid var(--c-border);
    border-radius: 999px; color: var(--c-text);
    padding: 3px 10px; cursor: pointer; font-size: 12px; font-weight: 500;
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .vote:hover:not(:disabled) {
    background: var(--c-bg-muted); border-color: var(--c-border-strong);
  }
  .vote:disabled { opacity: 0.5; cursor: default; }
  .comments-btn {
    background: transparent; border: none; color: var(--c-accent);
    font: inherit; font-size: 11px; font-weight: 500;
    cursor: pointer; padding: 3px 6px; border-radius: var(--r-xs);
    transition: background var(--t-fast);
  }
  .comments-btn:hover { background: var(--c-accent-bg); }
  .comments {
    margin-top: 4px; border-top: 1px solid var(--c-border); padding-top: 8px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .comment {
    padding: 8px 10px; border-radius: var(--r-sm);
    background: var(--c-bg-subtle); border: 1px solid var(--c-border);
    font-size: 11px; line-height: 1.55;
  }
  .comment-hdr {
    font-size: 10px; color: var(--c-text-muted);
    display: flex; align-items: center; gap: 5px; margin-bottom: 4px;
  }
  .comment-hdr img { width: 14px; height: 14px; border-radius: 999px; }
  .comment-body { color: var(--c-text); white-space: pre-wrap; word-break: break-word; }
  .compose textarea { min-height: 44px; font-size: 12px; }
  .compose-actions { display: flex; justify-content: flex-end; gap: 6px; }

  /* Overlay + hint (element picker on host page) */
  .overlay {
    position: fixed; pointer-events: none;
    border: 2px solid var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) 10%, transparent);
    z-index: 2147483645; transition: all .05s linear;
    border-radius: var(--r-xs);
  }
  .hint {
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: var(--c-text); color: var(--c-bg);
    padding: 8px 14px; border-radius: 999px;
    font-size: 12px; font-weight: 500;
    pointer-events: none;
    box-shadow: var(--shadow-lg);
  }

  /* Feature banner */
  .feature-banner {
    padding: 10px 12px; border-radius: var(--r-md); font-size: 12px; line-height: 1.45;
    background: var(--c-warning-bg);
    border: 1px solid color-mix(in srgb, var(--c-warning) 25%, transparent);
    color: var(--c-warning);
    display: flex; flex-direction: column; gap: 4px;
  }
  .feature-banner.ok {
    background: var(--c-success-bg);
    border-color: color-mix(in srgb, var(--c-success) 25%, transparent);
    color: var(--c-success);
  }
  .feature-banner.err {
    background: var(--c-danger-bg);
    border-color: color-mix(in srgb, var(--c-danger) 25%, transparent);
    color: var(--c-danger);
  }
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
    if (d.type === 'chorus:parent:render-pins') renderPins(d.pins || []);
  });

  // Element-pinned discussion badges. Rendered into a fixed overlay that
  // sits above the page content. On scroll/resize we reposition so pins
  // stay attached to their target elements.
  let pinsContainer = null;
  let currentPins = [];
  function renderPins(pins) {
    currentPins = pins;
    if (!pinsContainer) {
      pinsContainer = document.createElement('div');
      pinsContainer.style.cssText =
        'position:fixed; inset:0; pointer-events:none; z-index:2147483644;';
      document.body.appendChild(pinsContainer);
      window.addEventListener('scroll', repositionPins, { passive: true, capture: true });
      window.addEventListener('resize', repositionPins);
    }
    pinsContainer.innerHTML = '';
    for (const p of pins) {
      try {
        const el = deepQuerySelector(p.selector);
        if (!el) continue;
        const badge = document.createElement('button');
        badge.setAttribute('data-thread', String(p.number));
        const count = Math.max(1, (p.replyCount || 0) + 1);
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.title = p.title || `Discussion #${p.number}`;
        badge.style.cssText =
          'position:fixed; pointer-events:auto; cursor:pointer; ' +
          'min-width:24px; height:24px; padding:0 7px; border-radius:999px; ' +
          'background:linear-gradient(135deg,#6366f1 0%,#4338ca 100%); ' +
          'color:#fff; border:2px solid #fff; ' +
          'font:500 11px Inter,system-ui,sans-serif; ' +
          'display:inline-flex; align-items:center; justify-content:center; ' +
          'box-shadow:0 4px 12px -2px rgba(67,56,202,0.4), 0 0 0 2px rgba(67,56,202,0.15); ' +
          'transition:transform 120ms ease;';
        badge.addEventListener('click', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          try {
            window.parent.postMessage({
              type: 'chorus:preview:thread-open',
              number: p.number,
            }, '*');
          } catch {}
        });
        badge.addEventListener('mouseenter', () => { badge.style.transform = 'scale(1.1)'; });
        badge.addEventListener('mouseleave', () => { badge.style.transform = 'scale(1)'; });
        pinsContainer.appendChild(badge);
      } catch {}
    }
    repositionPins();
  }
  function repositionPins() {
    if (!pinsContainer) return;
    const badges = pinsContainer.children;
    for (const badge of badges) {
      const pin = currentPins.find((p) => String(p.number) === badge.getAttribute('data-thread'));
      if (!pin) continue;
      const el = deepQuerySelector(pin.selector);
      if (!el) { badge.style.display = 'none'; continue; }
      const r = el.getBoundingClientRect();
      badge.style.display = 'inline-flex';
      // Position at the top-right corner of the element, nudged up+right
      // so the pin sits on the element's edge.
      badge.style.left = (r.right - 10) + 'px';
      badge.style.top = (r.top - 10) + 'px';
    }
  }
  // Resolve a selector that may include '::shadow' boundary markers. We
  // walk the selector segments separated by ::shadow, querying each and
  // crossing shadow roots via .shadowRoot.
  function deepQuerySelector(selector) {
    if (!selector) return null;
    if (!selector.includes('::shadow')) {
      try { return document.querySelector(selector); } catch { return null; }
    }
    const segments = selector.split(/\s*>\s*::shadow\s*>\s*/);
    let ctx = document;
    for (let i = 0; i < segments.length; i++) {
      try {
        const found = ctx.querySelector(segments[i]);
        if (!found) return null;
        if (i === segments.length - 1) return found;
        ctx = found.shadowRoot;
        if (!ctx) return null;
      } catch { return null; }
    }
    return null;
  }

  function startPick() {
    if (picking) return;
    picking = true;
    // z-index must beat the inner chorus's own shadow-host (2147483646) so
    // the picker overlay + hint render on TOP of the inner popover rather
    // than being hidden behind it. Without this the red highlight is
    // invisible when hovering inside the popover.
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed; pointer-events:none; border:2px solid #4f46e5; ' +
      'background:rgba(79,70,229,0.10); border-radius:4px; z-index:2147483647; ' +
      'transition:all .05s linear; display:none;';
    document.body.appendChild(overlay);
    hint = document.createElement('div');
    hint.style.cssText =
      'position:fixed; top:20px; left:50%; transform:translateX(-50%); ' +
      'background:#0a0a0a; color:#fff; padding:8px 14px; border-radius:999px; ' +
      'font-size:12px; font-weight:500; pointer-events:none; z-index:2147483647; ' +
      'box-shadow:0 24px 48px -12px rgba(0,0,0,0.2); ' +
      'font-family:Inter,-apple-system,system-ui,sans-serif;';
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
  const savedViewMode = storeLoad('viewMode');

  // ── State ──────────────────────────────────────────────────────
  const state = {
    open: false,

    // Navigation
    screen: 'features',     // features | browse | propose | feature | ai | threadList | threadView | signIn | devicePending | keyPrompt | settings
                            // Features is the home — everything lives inside a feature (threads, branches, proposals).
                            // 'browse' remains as a flat-branch-list fallback reachable via the phylogeny or feature pages.
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

    // Overflow menu (in header)
    menuOpen: false,

    // Settings modal
    settingsModalOpen: false,

    // Discussion threads (element-pinned comment threads)
    threads: [],               // list for current page/branch: Thread[]
    threadsLoading: false,
    threadsError: null,
    threadsLoadedFor: '',      // staleness key (page + branch)
    currentThread: null,       // { issue, meta, initialText, comments }
    currentThreadLoading: false,
    threadComposeDraft: '',    // for thread-view reply compose
    newThreadDraft: '',        // for thread-compose from browse/feature
    newThreadFiling: false,

    // View mode — 'tree' (phylogeny) is the new default; 'list' is the
    // fallback in case the tree experiment doesn't land well.
    viewMode: savedViewMode === 'list' ? 'list' : 'tree',

    // Features (subreddit-style topic scopes)
    features: [],              // [{ name, rawName, description, color }]
    featuresLoading: false,
    featuresError: null,
    featuresLoaded: false,     // true once loadFeatures has succeeded at least once
    featuresSearch: '',
    featuresCreateOpen: false,
    featuresCreateDraft: { name: '', description: '' },
    featuresCreating: false,
    featuresCreateError: null,

    // Feature detail page ("subreddit" page): a single feature's threads.
    viewingFeature: null,               // { name, rawName, description, color } | null
    viewingFeatureThreads: [],          // threads tagged with this feature
    viewingFeatureThreadsLoading: false,
    viewingFeatureThreadsError: null,
    viewingFeatureLoadedFor: '',        // staleness key (feature name)

    // When the user hits "+ New thread" from a feature page we carry the
    // feature name through the propose flow so the created thread is tagged
    // with it. Cleared after the thread is created (or cancelled).
    pendingFeatureTag: null,            // string | null (feature name)

    // When the user hits "Pin to element" on the thread view, the next pick
    // updates that thread's meta instead of filling state.capture.
    pinningThreadNumber: null,          // number | null
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

  // ── Phylogeny host (horizontal band under the iframe) ─────────
  const phyHost = document.createElement('div');
  phyHost.className = 'phylogeny-host';
  const phyHeader = document.createElement('div');
  phyHeader.className = 'phylogeny-header';
  phyHost.appendChild(phyHeader);
  const phyBody = document.createElement('div');
  phyBody.className = 'phylogeny-body';
  phyHost.appendChild(phyBody);
  root.appendChild(phyHost);

  // Resize handles.
  //  - horizontal (chorus-resize-h): splits top row / phylogeny
  //  - vertical   (chorus-resize-v): splits iframe / panel
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'chorus-resize-h';
  root.appendChild(resizeHandle);
  const resizeHandleV = document.createElement('div');
  resizeHandleV.className = 'chorus-resize-v';
  root.appendChild(resizeHandleV);

  function updateResizeHandleVisibility() {
    const visible = wantPhyVisible();
    resizeHandle.classList.toggle('active', visible);
    resizeHandleV.classList.toggle('active', visible);
    // When the tall-column panel is active, pin the iframe's width to
    // fill the space to the left of the panel. Otherwise let it revert
    // to its default (62vw).
    if (visible) {
      // Iframe fills the space from the left margin (24px) up to the
      // start of the panel (which sits at right:24px with width
      // --chorus-panel-width), minus the gap between them.
      document.documentElement.style.setProperty(
        '--chorus-iframe-width',
        'calc(100vw - var(--chorus-panel-width, 420px) - 48px - var(--chorus-pane-gap, 12px))'
      );
    } else {
      document.documentElement.style.removeProperty('--chorus-iframe-width');
    }
  }

  // Drag logic.
  let dragStartY = 0;
  let dragStartHeight = 0;
  let dragging = false;
  resizeHandle.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartY = e.clientY;
    // Resolve current --chorus-top-height in pixels (might be '66vh' by
    // default, which we convert through getBoundingClientRect on the
    // iframe if it exists).
    const iframe = document.getElementById('oss-kanban-preview-iframe');
    dragStartHeight = iframe
      ? iframe.getBoundingClientRect().height
      : window.innerHeight * 0.66;
    resizeHandle.classList.add('dragging');
    resizeHandle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  resizeHandle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - dragStartY;
    const min = window.innerHeight * 0.2;
    const max = window.innerHeight * 0.85;
    const next = Math.max(min, Math.min(max, dragStartHeight + dy));
    document.documentElement.style.setProperty('--chorus-top-height', next + 'px');
    // Let d3-zoom's svg resize observer re-layout phylogeny:
    phylogeny?.resize();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    resizeHandle.classList.remove('dragging');
    try { resizeHandle.releasePointerCapture(e.pointerId); } catch {}
  };
  resizeHandle.addEventListener('pointerup', endDrag);
  resizeHandle.addEventListener('pointercancel', endDrag);

  // Vertical handle drag: updates --chorus-panel-width based on how far
  // the pointer is from the right edge of the viewport. Iframe width
  // follows automatically via calc(100vw - panelWidth - 48px).
  let vDragStartX = 0;
  let vDragStartWidth = 0;
  let vDragging = false;
  resizeHandleV.addEventListener('pointerdown', (e) => {
    vDragging = true;
    vDragStartX = e.clientX;
    const panel = panelEl;
    vDragStartWidth = panel
      ? panel.getBoundingClientRect().width
      : 420;
    resizeHandleV.classList.add('dragging');
    resizeHandleV.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  resizeHandleV.addEventListener('pointermove', (e) => {
    if (!vDragging) return;
    const dx = vDragStartX - e.clientX; // drag left = widen panel
    const min = 280;
    const max = window.innerWidth * 0.7;
    const next = Math.max(min, Math.min(max, vDragStartWidth + dx));
    document.documentElement.style.setProperty('--chorus-panel-width', next + 'px');
    phylogeny?.resize();
  });
  const endVDrag = (e) => {
    if (!vDragging) return;
    vDragging = false;
    resizeHandleV.classList.remove('dragging');
    try { resizeHandleV.releasePointerCapture(e.pointerId); } catch {}
  };
  resizeHandleV.addEventListener('pointerup', endVDrag);
  resizeHandleV.addEventListener('pointercancel', endVDrag);

  let phylogeny = null; // lazily created on first show
  let phyData = null;   // { commits, branches, mainName }
  let phyLoading = false;
  let phyLoadedForBranchSet = ''; // key of branch names to detect staleness

  function updatePhyHeader(status) {
    const counts = phyData ? `${phyData.branches.length} branches · ${phyData.commits.size} commits` : '';
    phyHeader.innerHTML = `
      <span class="mark" aria-hidden="true"></span>
      <span class="title">Phylogeny</span>
      ${counts ? `<span class="count">${esc(counts)}</span>` : ''}
      ${status ? `<span class="loading">${esc(status)}</span>` : ''}
      <button class="phy-reset" title="Reset view (fit all)">Fit view</button>
    `;
    phyHeader.querySelector('.phy-reset')?.addEventListener('click', () => {
      phylogeny?.resetView();
    });
  }

  function wantPhyVisible() {
    return state.open && state.viewMode === 'tree' && configOK();
  }

  async function refreshPhylogeny() {
    if (!state.branches?.length) return;
    const key = state.branches.map((b) => `${b.name}@${b.commit?.sha?.slice(0,7)}`).sort().join(',');
    if (phyLoadedForBranchSet === key && phyData) {
      renderPhylogeny();
      return;
    }
    phyLoading = true;
    updatePhyHeader('loading commit history…');
    try {
      phyData = await loadPhylogenyData({
        token: state.token, owner: OWNER, repo: REPONAME,
        branches: state.branches, gh,
      });
      phyLoadedForBranchSet = key;
    } catch (err) {
      if (DEBUG) console.log('[chorus] phylogeny load failed', err);
    } finally {
      phyLoading = false;
      renderPhylogeny();
    }
  }

  function renderPhylogeny() {
    const visible = wantPhyVisible();
    phyHost.classList.toggle('active', visible);
    updateResizeHandleVisibility();
    if (!visible) return;
    if (!phyData) {
      updatePhyHeader(phyLoading ? 'loading commit history…' : 'no data yet');
      return;
    }
    if (!phylogeny) {
      phylogeny = createPhylogeny(phyBody, {
        onSelectBranch: (branchName) => {
          // Reuse the existing branch-selection flow.
          selectBranch(branchName);
        },
      });
    }
    updatePhyHeader('');
    phylogeny.render(phyData, state.currentBranch || state.featureBranch);
  }

  // Re-layout on window resize.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => phylogeny?.resize(), 150);
  });

  // Close the header overflow menu on outside click / Escape.
  document.addEventListener('click', (e) => {
    if (!state.menuOpen) return;
    // Clicks inside the shadow root show up here with shadow-host as target
    // in chromium — use composedPath to look for .menu-btn or .menu in the
    // full retargeted path.
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const insideMenu = path.some((n) => n?.classList?.contains?.('menu-wrap'));
    if (insideMenu) return;
    state.menuOpen = false;
    renderPanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.settingsModalOpen) { state.settingsModalOpen = false; renderPanel(); return; }
    if (state.menuOpen) { state.menuOpen = false; renderPanel(); }
  });

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
    // Kick off phylogeny data load on first open. Safe to call repeatedly —
    // it no-ops if the branch-set hasn't changed.
    refreshPhylogeny();
    // Load discussion threads in the background so pins can render on
    // the preview iframe. Cheap: single labeled-issues API call, cached
    // until the branch/page changes.
    if (state.token && configOK()) {
      loadThreads().catch(() => {});
    }
    // Load features (topic scopes) for the home screen. Cheap: single
    // labels API call. Works unauth'd too on public repos.
    if (configOK()) {
      loadFeatures().catch(() => {});
    }
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
    renderPhylogeny(); // will hide it (wantPhyVisible() is false when closed)
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
    else state.screen = 'features';
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
    if (!state.open) {
      // Panel closed — also clear any modals.
      if (settingsModalEl) { settingsModalEl.remove(); settingsModalEl = null; }
      renderTrigger(); return;
    }
    panelEl?.remove();
    panelEl = document.createElement('div');
    // When the phylogeny is visible in the band below the iframe, the
    // panel becomes a tall right-hand column so the phylogeny can
    // stretch full-width underneath.
    panelEl.className = 'panel' + (wantPhyVisible() ? ' with-phylogeny' : '');

    const header = renderHeader();
    const body = renderBody();
    const actionBar = renderActionBar();

    panelEl.appendChild(header);
    panelEl.appendChild(body);
    if (actionBar) panelEl.appendChild(actionBar);
    root.appendChild(panelEl);

    wirePanel();
    renderTrigger();
    renderSettingsModal();
  }

  let settingsModalEl = null;
  function renderSettingsModal() {
    if (!state.settingsModalOpen) {
      if (settingsModalEl) { settingsModalEl.remove(); settingsModalEl = null; }
      return;
    }
    if (settingsModalEl) settingsModalEl.remove();
    settingsModalEl = document.createElement('div');
    settingsModalEl.className = 'settings-backdrop';
    const actionBarHtml = settingsActions();
    settingsModalEl.innerHTML = `
      <div class="settings-modal">
        <div class="header">
          <div class="title">Settings</div>
          <button class="close" data-action="close-settings" title="Close">✕</button>
        </div>
        <div class="body">
          ${settingsHtml()}
        </div>
        ${actionBarHtml ? `<div class="action-bar">${actionBarHtml}</div>` : ''}
      </div>
    `;
    root.appendChild(settingsModalEl);
    wireSettingsModal();
  }

  function wireSettingsModal() {
    if (!settingsModalEl) return;
    const on = (sel, ev, fn) => settingsModalEl.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
    const close = () => { state.settingsModalOpen = false; renderPanel(); };
    on('[data-action="close-settings"]', 'click', close);
    // Click on the backdrop (outside the modal itself) closes.
    settingsModalEl.addEventListener('click', (e) => {
      if (e.target === settingsModalEl) close();
    });
    // Reuse the wirePanel handlers that map data-actions to settings
    // behaviour, by attaching the same listeners scoped to the modal.
    on('[data-action="sign-in"]', 'click', startDeviceFlow);
    on('[data-action="sign-out"]', 'click', () => {
      signOut();
      state.settingsModalOpen = false;
      renderPanel();
    });
    on('[data-action="clear-key"]', 'click', () => {
      state.openaiKey = null; storeClear('openaiKey'); renderPanel();
    });
    const modelSelect = settingsModalEl.querySelector('[data-field="model"]');
    modelSelect?.addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__custom__') {
        renderPanel();
        settingsModalEl?.querySelector('[data-field="model-custom"]')?.focus();
      } else {
        state.openaiModel = v; storeSave('openaiModel', v); renderPanel();
      }
    });
    const modelCustom = settingsModalEl.querySelector('[data-field="model-custom"]');
    modelCustom?.addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (!v) return;
      state.openaiModel = v; storeSave('openaiModel', v);
    });
    // OpenAI key input (appears when user is setting a key)
    const keyInput = settingsModalEl.querySelector('[data-field="openai-key"]');
    if (keyInput && state.openaiKey) keyInput.value = state.openaiKey;
    on('[data-action="save-key"]', 'click', () => {
      const v = settingsModalEl.querySelector('[data-field="openai-key"]')?.value?.trim();
      if (!v) return;
      state.openaiKey = v; storeSave('openaiKey', v);
      renderPanel();
    });
  }

  // Header
  function renderHeader() {
    const title = headerTitle();
    const canBack = state.backStack.length > 0;
    // The header's overflow-menu button contains: view-mode toggle,
    // settings, sign-out. Hidden on signIn / devicePending where it'd
    // be contextually wrong (user hasn't finished auth yet).
    const showMenu = configOK() && !['signIn', 'devicePending'].includes(state.screen);
    const el = document.createElement('div');
    el.className = 'header';
    el.innerHTML = `
      ${showMenu ? `
        <div class="menu-wrap">
          <button class="menu-btn" data-action="toggle-menu" title="Menu" aria-expanded="${state.menuOpen ? 'true' : 'false'}">☰</button>
          ${state.menuOpen ? menuHtml() : ''}
        </div>
      ` : ''}
      <button class="back" ${canBack ? '' : 'hidden'} data-action="back" title="Back">←</button>
      <div class="title">${title}</div>
      <button class="close" data-action="close" title="Close">✕</button>
    `;
    return el;
  }

  function menuHtml() {
    const authed = auth.isAuthed();
    return `
      <div class="menu">
        <div class="menu-section-label">Browse</div>
        <button class="menu-item" data-action="goto-features-menu">
          <span class="menu-check"></span>
          <span>Features</span>
        </button>
        <div class="menu-divider"></div>
        <div class="menu-section-label">View</div>
        <button class="menu-item ${state.viewMode === 'tree' ? 'checked' : ''}" data-action="set-view-tree">
          <span class="menu-check">${state.viewMode === 'tree' ? '✓' : ''}</span>
          <span>Phylogeny</span>
        </button>
        <button class="menu-item ${state.viewMode === 'list' ? 'checked' : ''}" data-action="set-view-list">
          <span class="menu-check">${state.viewMode === 'list' ? '✓' : ''}</span>
          <span>List</span>
        </button>
        <div class="menu-divider"></div>
        <button class="menu-item" data-action="goto-settings-menu">
          <span class="menu-check"></span>
          <span>Settings</span>
        </button>
        ${authed && state.user ? `
          <div class="menu-divider"></div>
          <div class="menu-identity">
            <img src="${esc(state.user.avatar_url)}" alt="" />
            <span>Signed in as <strong>${esc(state.user.login)}</strong></span>
          </div>
          <button class="menu-item" data-action="sign-out-menu">
            <span class="menu-check"></span>
            <span>Sign out</span>
          </button>
        ` : `
          <button class="menu-item" data-action="sign-in-menu">
            <span class="menu-check"></span>
            <span>Sign in with GitHub</span>
          </button>
        `}
      </div>
    `;
  }
  function headerTitle() {
    if (!configOK()) return 'Chorus';
    switch (state.screen) {
      case 'browse':        return `${esc(REPO)}`;
      case 'features':      return 'Features';
      case 'featurePage':   return state.viewingFeature
                              ? `<code>${esc(state.viewingFeature.name)}</code>`
                              : 'Feature';
      case 'propose':       return 'Start a thread';
      case 'feature':       return `<code>${esc(state.featureBranch || '…')}</code>`;
      case 'ai':            return state.ai?.status === 'running'
                              ? `AI working on <code>${esc(state.ai.branch || '…')}</code>`
                              : `<code>${esc(state.ai?.branch || '…')}</code>`;
      case 'threadList':    return 'Threads';
      case 'threadView':    return state.currentThread?.issue
                              ? `Thread #${state.currentThread.issue.number}`
                              : 'Thread';
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
        case 'features':      return featuresHtml();
        case 'featurePage':   return featurePageHtml();
        case 'propose':       return proposeHtml();
        case 'feature':       return featureHtml();
        case 'ai':            return aiHtml();
        case 'threadList':    return threadListHtml();
        case 'threadView':    return threadViewHtml();
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
      case 'features':      html = featuresActions(); break;
      case 'featurePage':   html = featurePageActions(); break;
      case 'propose':       html = proposeActions(); break;
      case 'feature':       html = featureActions(); break;
      case 'ai':            html = aiActions(); break;
      case 'threadList':    html = threadListActions(); break;
      case 'threadView':    html = threadViewActions(); break;
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
    return state.viewMode === 'tree' ? browseTreeHtml() : browseListHtml();
  }

  function browseListHtml() {
    const main = state.branches.find((b) => b.name === 'main' || b.name === 'master');
    const features = state.branches.filter((b) => b.name.startsWith('feature/'));
    const autos = state.branches.filter((b) => b.name.startsWith('auto/') && b !== main);
    const misc = state.branches.filter((b) => b !== main && !b.name.startsWith('feature/') && !b.name.startsWith('auto/'));
    return `
      <p class="muted">Pick a branch to see its preview, discussion, and AI history — or suggest a new change.</p>
      ${state.branchesError ? `<div class="err">${esc(state.branchesError)}</div>` : ''}
      ${state.branchesLoading && !state.branches.length ? `
        <div class="branch-list">
          <div class="skeleton" style="height:34px;margin:2px 0;"></div>
          <div class="skeleton" style="height:34px;margin:2px 0;width:88%;"></div>
          <div class="skeleton" style="height:34px;margin:2px 0;width:92%;"></div>
        </div>
      ` : ''}
      ${main ? `<div class="branch-list">${branchItem(main, 'main')}</div>` : ''}
      ${features.length ? `<div class="section-heading">Features</div><div class="branch-list">${features.map((b) => branchItem(b, 'feature')).join('')}</div>` : ''}
      ${autos.length ? `<div class="section-heading">Auto branches</div><div class="branch-list">${autos.map((b) => branchItem(b, 'auto')).join('')}</div>` : ''}
      ${misc.length ? `<div class="section-heading">Other</div><div class="branch-list">${misc.map((b) => branchItem(b, '')).join('')}</div>` : ''}
    `;
  }

  // In tree view the actual phylogeny lives in the horizontal band under
  // the iframe — the panel becomes a lightweight 'you are here' card with
  // auth status + quick actions. Click a tip on the phylogeny to navigate.
  function browseTreeHtml() {
    return `
      ${state.branchesError ? `<div class="err">${esc(state.branchesError)}</div>` : ''}
      ${state.branchesLoading && !state.branches.length ? `
        <div class="skeleton" style="height:80px;"></div>
      ` : ''}
      <button class="nav-card" data-action="goto-features">
        <div class="nav-card-mark"></div>
        <div>
          <div class="nav-card-title">Features</div>
          <div class="muted-s">Topic scopes — like subreddits — that group threads and branches</div>
        </div>
        <div class="nav-card-chev">→</div>
      </button>
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
    // No refresh button — branches are reloaded automatically on panel
    // open and after mutations (merges / AI commits).
    return '';
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
      // If the phylogeny is visible, load its deeper data now that we
      // know the branch set. No-ops if the panel isn't open.
      refreshPhylogeny();
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
    const captureInfo = capture
      ? `<${esc(capture.tag)}> ${esc(capture.selector)}${capture.text ? ` — "${esc(capture.text.slice(0, 60))}"` : ''}`
      : 'No element pinned <span class="muted-s">(optional)</span>';
    const features = state.features || [];
    // Pick the selected feature: the user's set value, falling back to the
    // first feature so the form never submits with no feature set.
    const selected = (state.pendingFeatureTag && features.some((f) => f.name === state.pendingFeatureTag))
      ? state.pendingFeatureTag
      : (features[0]?.name || '');
    const featurePickerHtml = features.length === 0
      ? `
        <div class="empty-state">
          <div class="empty-state-title">You need a feature first</div>
          <div class="muted-s">Every thread lives inside a feature — topic scopes like <code>auth</code> or <code>pricing</code>. <button class="link-btn" data-action="goto-features-menu">Create one</button>, then come back.</div>
        </div>
      `
      : `
        <label class="field">
          Feature
          <select data-field="propose-feature">
            ${features.map((f) => `
              <option value="${esc(f.name)}" ${f.name === selected ? 'selected' : ''}>${esc(f.name)}</option>
            `).join('')}
          </select>
          <div class="muted-s" style="margin-top:4px;">Every thread lives inside a feature. Pick the one this belongs to.</div>
        </label>
      `;
    const pickBtn = state.pickMode
      ? `<button class="link-btn" data-action="pick">Cancel pick</button>`
      : capture
        ? `<button class="link-btn" data-action="pick">Re-pin</button>
           <button class="link-btn" data-action="clear-capture">Unpin</button>`
        : `<button class="link-btn" data-action="pick">Pin element</button>`;
    return `
      <p class="muted">Start a thread. Pinning to an element is optional — you can pin now or from the thread later.</p>

      ${featurePickerHtml}

      <div class="pin-card ${capture ? '' : 'empty'}">
        <div class="pin-card-dot ${capture ? 'filled' : ''}"></div>
        <div class="pin-card-info">${captureInfo}</div>
        <div class="pin-card-actions">${pickBtn}</div>
      </div>
      <label class="field">
        What's on your mind?
        <textarea data-field="description" placeholder="e.g. this button feels too loud — could it be softer?">${esc(state.description)}</textarea>
      </label>
      ${state.authError ? `<div class="err">${esc(state.authError)}</div>` : ''}
    `;
  }

  function proposeActions() {
    const hasText = !!state.description.trim();
    const features = state.features || [];
    const hasFeature = features.length > 0;
    const canStart = hasText && hasFeature && !state.filing;
    const startLabel = state.filing ? 'Starting…' : 'Start thread';
    return `
      <div class="secondary"></div>
      <button class="primary" data-action="start-discussion" ${canStart ? '' : 'disabled'}>${startLabel}</button>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Feature detail
  // ═══════════════════════════════════════════════════════════════
  function featureHtml() {
    const branch = state.featureBranch;
    const isMain = branch === 'main' || branch === 'master';
    return `
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
      ${!isMain ? `<button class="primary" data-action="refine" ${authed ? '' : 'disabled title="Sign in to refine"'}>🤖 Refine with AI</button>` : ''}
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Features (subreddit-style topic scopes)
  // ═══════════════════════════════════════════════════════════════
  function featuresHtml() {
    const q = (state.featuresSearch || '').trim().toLowerCase();
    const filtered = q
      ? state.features.filter((f) =>
          f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q))
      : state.features;
    const loading = state.featuresLoading && !state.features.length;
    const hasFeatures = state.features.length > 0;
    const noMatch = hasFeatures && filtered.length === 0;
    const emptyAll = !loading && !hasFeatures && !state.featuresError;

    return `
      <p class="muted">Features are topic scopes — like subreddits — that group threads, branches and proposals. An item can belong to many features.</p>

      ${state.featuresError ? `<div class="err">${esc(state.featuresError)}</div>` : ''}

      <div class="features-toolbar">
        <input
          class="features-search"
          type="search"
          placeholder="Search features…"
          data-field="features-search"
          value="${esc(state.featuresSearch)}"
          ${hasFeatures ? '' : 'disabled'}
        />
      </div>

      ${state.featuresCreateOpen ? featuresCreateFormHtml() : ''}

      ${loading ? `
        <div class="features-grid">
          <div class="skeleton" style="height:88px;"></div>
          <div class="skeleton" style="height:88px;"></div>
          <div class="skeleton" style="height:88px;"></div>
          <div class="skeleton" style="height:88px;"></div>
        </div>
      ` : ''}

      ${emptyAll ? `
        <div class="empty-state">
          <div class="empty-state-title">No features yet</div>
          <div class="muted-s">Create one to group related threads, branches and proposals. Examples: <code>auth</code>, <code>pricing</code>, <code>onboarding</code>.</div>
        </div>
      ` : ''}

      ${noMatch ? `
        <div class="empty-state">
          <div class="empty-state-title">No features match “${esc(state.featuresSearch)}”</div>
          <div class="muted-s">Adjust your search, or create a new feature.</div>
        </div>
      ` : ''}

      ${!loading && filtered.length ? `
        <div class="features-grid">
          ${filtered.map(featureCardHtml).join('')}
        </div>
      ` : ''}
    `;
  }

  function featureCardHtml(f) {
    const color = (f.color || '64748b').replace(/^#/, '');
    const desc = f.description ? esc(f.description) : '<span class="muted-s">No description.</span>';
    return `
      <button class="feature-card" data-action="open-feature" data-feature="${esc(f.name)}" title="Open feature ${esc(f.name)}">
        <div class="feature-card-head">
          <span class="feature-swatch" style="background:#${esc(color)}"></span>
          <span class="feature-name">${esc(f.name)}</span>
        </div>
        <div class="feature-card-desc">${desc}</div>
      </button>
    `;
  }

  function featuresCreateFormHtml() {
    const { name, description } = state.featuresCreateDraft;
    const slug = name ? slugifyFeatureNameClient(name) : '';
    const canCreate = !!slug && !state.featuresCreating;
    return `
      <div class="features-create">
        <div class="features-create-head">
          <div class="features-create-title">New feature</div>
          <button class="features-create-close" data-action="features-cancel-create" title="Cancel">✕</button>
        </div>
        <label class="field">
          Name
          <input type="text" data-field="features-create-name" value="${esc(name)}" placeholder="e.g. auth" maxlength="48" />
          ${slug && slug !== name ? `<div class="muted-s">Will be saved as <code>${esc(slug)}</code></div>` : ''}
        </label>
        <label class="field">
          Description <span class="muted-s">(optional)</span>
          <textarea data-field="features-create-description" placeholder="What belongs in this feature?">${esc(description)}</textarea>
        </label>
        ${state.featuresCreateError ? `<div class="err">${esc(state.featuresCreateError)}</div>` : ''}
        <div class="features-create-actions">
          <button data-action="features-cancel-create">Cancel</button>
          <button class="primary" data-action="features-submit-create" ${canCreate ? '' : 'disabled'}>
            ${state.featuresCreating ? 'Creating…' : 'Create feature'}
          </button>
        </div>
      </div>
    `;
  }

  function featuresActions() {
    const authed = auth.isAuthed();
    // No refresh button — features reload on panel open and after create.
    return `
      <div class="secondary"></div>
      <button class="primary" data-action="features-open-create" ${authed ? '' : 'disabled title="Sign in to create features"'}>
        + New feature
      </button>
    `;
  }

  // Client-side copy of gh-client's slugifyFeatureName so we can show the
  // resolved slug in the create form without reaching for the network.
  function slugifyFeatureNameClient(name) {
    return String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  async function loadFeatures({ force = false } = {}) {
    if (!force && state.featuresLoaded && state.features.length) return;
    state.featuresLoading = true;
    state.featuresError = null;
    renderPanel();
    try {
      state.features = await gh.listFeatures(state.token, OWNER, REPONAME);
      state.featuresLoaded = true;
    } catch (err) {
      state.featuresError = String(err?.message || err);
    } finally {
      state.featuresLoading = false;
      renderPanel();
    }
  }

  async function submitCreateFeature() {
    if (!requireAuth('features')) return;
    if (state.featuresCreating) return;
    const { name, description } = state.featuresCreateDraft;
    const slug = slugifyFeatureNameClient(name);
    if (!slug) return;
    state.featuresCreating = true;
    state.featuresCreateError = null;
    renderPanel();
    try {
      const created = await gh.createFeature(state.token, OWNER, REPONAME, {
        name: slug,
        description: (description || '').trim(),
      });
      // Merge into the list without a full reload. Dedupe in case GH raced.
      const exists = state.features.some((f) => f.name === created.name);
      if (!exists) state.features = [...state.features, created].sort((a, b) => a.name.localeCompare(b.name));
      state.featuresCreateOpen = false;
      state.featuresCreateDraft = { name: '', description: '' };
    } catch (err) {
      // GH returns 422 on duplicate label — surface a friendly message.
      const msg = String(err?.message || err);
      if (msg.includes(' 422')) {
        state.featuresCreateError = `A feature named "${slug}" already exists.`;
      } else {
        state.featuresCreateError = msg;
      }
    } finally {
      state.featuresCreating = false;
      renderPanel();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Feature page (a single feature's threads — "subreddit" page)
  // ═══════════════════════════════════════════════════════════════
  function featurePageHtml() {
    const f = state.viewingFeature;
    if (!f) {
      return `<div class="muted">Feature not found.</div>`;
    }
    const color = (f.color || '64748b').replace(/^#/, '');
    const threads = state.viewingFeatureThreads;
    const loading = state.viewingFeatureThreadsLoading && !threads.length;
    const empty = !loading && !threads.length && !state.viewingFeatureThreadsError;

    return `
      <div class="feature-header">
        <div class="feature-header-row">
          <span class="feature-swatch lg" style="background:#${esc(color)}"></span>
          <span class="feature-name-lg">${esc(f.name)}</span>
        </div>
        ${f.description ? `<div class="feature-header-desc">${esc(f.description)}</div>` : ''}
      </div>

      ${state.viewingFeatureThreadsError ? `<div class="err">${esc(state.viewingFeatureThreadsError)}</div>` : ''}

      ${loading ? `
        <div class="thread-list">
          <div class="skeleton" style="height:60px;"></div>
          <div class="skeleton" style="height:60px;"></div>
        </div>
      ` : ''}

      ${empty ? `
        <div class="empty-state">
          <div class="empty-state-title">No threads in this feature yet</div>
          <div class="muted-s">Pick an element on the page and start a thread — it'll be tagged with <code>${esc(f.name)}</code>.</div>
        </div>
      ` : ''}

      ${!loading && threads.length ? `
        <div class="thread-list">
          ${threads.map(threadListItem).join('')}
        </div>
      ` : ''}
    `;
  }

  function featurePageActions() {
    const authed = auth.isAuthed();
    return `
      <div class="secondary"></div>
      <button class="primary" data-action="feature-new-thread" ${authed ? '' : 'disabled title="Sign in to start a thread"'}>
        + New thread
      </button>
    `;
  }

  function openFeature(feature) {
    if (!feature) return;
    state.viewingFeature = feature;
    state.viewingFeatureThreads = [];
    state.viewingFeatureThreadsError = null;
    state.viewingFeatureLoadedFor = '';
    navigate('featurePage');
    loadFeatureThreads();
  }

  async function loadFeatureThreads({ force = false } = {}) {
    const f = state.viewingFeature;
    if (!f) return;
    const key = f.name;
    if (!force && state.viewingFeatureLoadedFor === key && state.viewingFeatureThreads.length) return;
    state.viewingFeatureThreadsLoading = true;
    state.viewingFeatureThreadsError = null;
    renderPanel();
    try {
      const threads = await gh.listDiscussionThreads(state.token, OWNER, REPONAME, {
        featureName: f.name,
      });
      state.viewingFeatureThreads = threads;
      state.viewingFeatureLoadedFor = key;
    } catch (err) {
      state.viewingFeatureThreadsError = String(err?.message || err);
    } finally {
      state.viewingFeatureThreadsLoading = false;
      if (state.screen === 'featurePage') renderPanel();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Thread list (element-pinned discussion threads)
  // ═══════════════════════════════════════════════════════════════
  function threadListHtml() {
    const loading = state.threadsLoading && !state.threads.length;
    const empty = !loading && !state.threads.length;
    return `
      <p class="muted">Threads on this page. Each is pinned to an element you can click back into.</p>
      ${state.threadsError ? `<div class="err">${esc(state.threadsError)}</div>` : ''}
      ${loading ? `<div class="skeleton" style="height:60px;"></div><div class="skeleton" style="height:60px;"></div>` : ''}
      ${empty ? `
        <div class="empty-state">
          <div class="empty-state-title">No threads yet</div>
          <div class="muted-s">Pick an element on the page and drop a comment. Any reply can later trigger an AI build on its own branch.</div>
        </div>
      ` : ''}
      <div class="thread-list">
        ${state.threads.map(threadListItem).join('')}
      </div>
    `;
  }

  function threadListItem(t) {
    const meta = t.meta || {};
    const firstLine = (t.initialText || '').split('\n')[0].slice(0, 120);
    const ageStr = relativeTimeStr(t.updated_at || t.created_at);
    const tagLabel = meta.tag ? `<${esc(meta.tag)}>` : '';
    const elText = meta.text ? `“${esc(meta.text.slice(0, 40))}${meta.text.length > 40 ? '…' : ''}”` : '';
    return `
      <button class="thread-item" data-action="open-thread" data-number="${t.number}">
        <div class="thread-item-head">
          <span class="thread-num">#${t.number}</span>
          <span class="thread-el">${tagLabel} ${elText}</span>
          <span class="thread-age">${esc(ageStr)}</span>
        </div>
        <div class="thread-item-body">${esc(firstLine)}</div>
        <div class="thread-item-meta">
          <span class="muted-s">${t.comments} ${t.comments === 1 ? 'reply' : 'replies'}</span>
        </div>
      </button>
    `;
  }

  function threadListActions() {
    // No refresh button — threads are reloaded on panel open and after
    // any create/close/promote mutation.
    return `
      <div class="secondary"></div>
      <button class="primary" data-action="goto-propose-discuss">+ New thread</button>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN: Thread view (single discussion with replies)
  // ═══════════════════════════════════════════════════════════════
  function threadViewHtml() {
    if (state.currentThreadLoading && !state.currentThread) {
      return `<div class="skeleton" style="height:120px;"></div><div class="skeleton" style="height:60px;"></div>`;
    }
    const t = state.currentThread;
    if (!t) return `<div class="muted">Thread not found.</div>`;
    const issue = t.issue || {};
    const meta = t.meta || {};
    const hasPin = !!(meta.selector && meta.tag);
    const authed = auth.isAuthed();

    // OP meta: feature (primary if multiple), author, age
    const featureLabels = (issue.labels || [])
      .map((l) => (typeof l === 'string' ? l : l.name))
      .filter((n) => typeof n === 'string' && n.startsWith('chorus:feature:'))
      .map((n) => n.slice('chorus:feature:'.length));
    const primaryFeature = featureLabels[0] || null;
    const opAuthor = issue.user || {};
    const opAge = relativeTimeStr(issue.created_at);

    // Vote score on the OP from reactions
    const opReactions = issue.reactions || {};
    const opScore = (opReactions['+1'] || 0) - (opReactions['-1'] || 0);

    // Pin summary / affordance
    const pinning = state.pinningThreadNumber === issue.number;
    const pinBtnLabel = pinning ? 'Picking…' : (hasPin ? 'Re-pin' : 'Pin element');
    const elSummary = hasPin
      ? `<${esc(meta.tag)}>${meta.text ? ` “${esc(meta.text.slice(0, 60))}${meta.text.length > 60 ? '…' : ''}”` : ''}`
      : '';
    const pageStr = meta.page ? `on <code>${esc(meta.page)}</code>` : '';

    const comments = t.comments || [];
    const commentCount = comments.length;
    const issueOpen = issue.state === 'open';

    return `
      <article class="reddit-op">
        <div class="vote-col">
          <button class="vote-btn up" data-action="vote-op" data-dir="up" ${authed ? '' : 'disabled'} title="Upvote">▲</button>
          <span class="vote-score">${opScore}</span>
          <button class="vote-btn down" data-action="vote-op" data-dir="down" ${authed ? '' : 'disabled'} title="Downvote">▼</button>
        </div>
        <div class="op-main">
          <div class="op-meta">
            ${primaryFeature ? `<span class="op-feature">r/${esc(primaryFeature)}</span><span class="op-sep">·</span>` : ''}
            <span class="op-author">${opAuthor.avatar_url ? `<img src="${esc(opAuthor.avatar_url)}" alt="" />` : ''}${esc(opAuthor.login || 'someone')}</span>
            <span class="op-sep">·</span>
            <span class="op-age">${esc(opAge)}</span>
            ${!issueOpen ? `<span class="op-sep">·</span><span class="op-resolved">resolved</span>` : ''}
          </div>
          ${issue.title ? `<h2 class="op-title">${esc(issue.title)}</h2>` : ''}
          ${t.initialText ? `<div class="op-body">${esc(t.initialText)}</div>` : ''}
          <div class="pin-card compact ${hasPin ? '' : 'empty'}">
            <div class="pin-card-dot ${hasPin ? 'filled' : ''}"></div>
            <div class="pin-card-info">
              ${hasPin ? elSummary : 'Not pinned'}${pageStr ? `<span class="pin-card-page"> · ${pageStr}</span>` : ''}
            </div>
            ${authed ? `
              <div class="pin-card-actions">
                <button class="link-btn" data-action="pin-thread" ${pinning ? 'disabled' : ''}>${pinBtnLabel}</button>
                ${hasPin ? `<button class="link-btn" data-action="unpin-thread" title="Remove this pin">Unpin</button>` : ''}
              </div>
            ` : ''}
          </div>
          <div class="op-actions">
            <span class="op-stat">💬 ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}</span>
            ${issue.html_url ? `<a class="op-stat link" href="${esc(issue.html_url)}" target="_blank" rel="noopener">↗ open on GitHub</a>` : ''}
            ${authed && issueOpen ? `<button class="link-btn op-resolve" data-action="close-thread" title="Mark this thread resolved">Resolve</button>` : ''}
          </div>
        </div>
      </article>

      <div class="comments-header">
        <span class="comments-count">${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}</span>
        <span class="comments-sort muted-s">sorted by <strong>new</strong></span>
      </div>

      <div class="comments-section">
        ${comments.length === 0
          ? `<div class="muted-s" style="padding:8px 4px">No comments yet. Be the first.</div>`
          : comments.map(redditComment).join('')}
      </div>

      ${issueOpen ? `
        <label class="field reply-composer">
          Add a comment
          <textarea data-field="thread-reply" placeholder="Reply to discuss — or describe a change and click 🤖 Build with AI to spin up a branch.">${esc(state.threadComposeDraft || '')}</textarea>
        </label>
      ` : ''}
    `;
  }

  function redditComment(c) {
    const author = c.user || c.author || {};
    const body = c.body || '';
    const avatar = author.avatar_url ? `<img src="${esc(author.avatar_url)}" alt="" />` : '';
    const login = author.login || 'someone';
    const age = relativeTimeStr(c.created_at);
    const reactions = c.reactions || {};
    const score = (reactions['+1'] || 0) - (reactions['-1'] || 0);
    const authed = auth.isAuthed();
    return `
      <div class="reddit-comment" data-comment-id="${c.id}">
        <div class="vote-col">
          <button class="vote-btn up" data-action="vote-comment" data-comment-id="${c.id}" data-dir="up" ${authed ? '' : 'disabled'} title="Upvote">▲</button>
          <span class="vote-score">${score}</span>
          <button class="vote-btn down" data-action="vote-comment" data-comment-id="${c.id}" data-dir="down" ${authed ? '' : 'disabled'} title="Downvote">▼</button>
        </div>
        <div class="comment-main">
          <div class="comment-hdr">
            ${avatar}
            <span class="name">${esc(login)}</span>
            <span class="age">${esc(age)}</span>
          </div>
          <div class="comment-body">${esc(body)}</div>
        </div>
      </div>
    `;
  }

  function threadViewActions() {
    const hasDraft = (state.threadComposeDraft || '').trim().length > 0;
    const t = state.currentThread;
    const issueOpen = t?.issue?.state === 'open';
    if (!issueOpen) {
      return `<div class="secondary"><span class="muted-s">Thread resolved</span></div>`;
    }
    return `
      <div class="secondary">
        <button data-action="post-thread-reply" ${hasDraft ? '' : 'disabled'}>Comment</button>
      </div>
      <button class="primary" data-action="thread-build" ${hasDraft ? '' : 'disabled'} title="Spin up a branch: run AI with this message as the prompt">🤖 Build with AI</button>
    `;
  }

  function relativeTimeStr(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    if (d < 2592000) return `${Math.floor(d / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  // ── Thread data loaders ────────────────────────────────────────

  async function loadThreads({ force = false } = {}) {
    const page = state.currentPath || 'index.html';
    const key = `${page}|${state.featureBranch || state.currentBranch || 'main'}`;
    if (!force && state.threadsLoadedFor === key && state.threads.length) return;
    state.threadsLoading = true;
    state.threadsError = null;
    renderPanel();
    try {
      const threads = await gh.listDiscussionThreads(state.token, OWNER, REPONAME, { page });
      state.threads = threads;
      state.threadsLoadedFor = key;
    } catch (err) {
      state.threadsError = String(err?.message || err);
    } finally {
      state.threadsLoading = false;
      renderPanel();
      // Send to iframe so pins render.
      broadcastThreadsToPreview();
    }
  }

  async function openThread(issueNumber) {
    state.currentThread = null;
    state.currentThreadLoading = true;
    state.threadComposeDraft = '';
    navigate('threadView');
    try {
      state.currentThread = await gh.getDiscussionThread(state.token, OWNER, REPONAME, issueNumber);
    } catch (err) {
      state.currentThread = null;
      state.threadsError = String(err?.message || err);
    } finally {
      state.currentThreadLoading = false;
      renderPanel();
    }
  }

  // Create a thread pinned to the current element with the current compose
  // text as the initial message. If `thenBuild` is true, additionally kick
  // off an AI build whose generated branch is announced back in the thread.
  async function startDiscussion(thenBuild = false) {
    if (!requireAuth('threadList')) return;
    if (state.newThreadFiling) return;
    const text = state.description.trim();
    if (!text) return;
    if (thenBuild && !state.openaiKey) {
      state.pendingIntent = 'start-and-build';
      navigate('keyPrompt');
      return;
    }
    state.newThreadFiling = true;
    state.filing = true;
    renderPanel();
    try {
      const cap = state.capture;
      // Meta always records the page; selector/text/tag/bbox are only
      // present when an element is pinned. Threads can exist without a pin.
      const meta = cap ? {
        selector: cap.selector,
        text: cap.text,
        tag: cap.tag,
        page: state.currentPath || 'index.html',
        bbox: cap.rect,
      } : {
        page: state.currentPath || 'index.html',
      };
      // Title: pinned element's text → element tag → first line of the message.
      const title = cap?.text?.slice(0, 60)
        || (cap ? `<${cap.tag}>` : (text.split('\n')[0].slice(0, 60) || 'Thread'));
      // Feature tag: user's explicit pick, falling back to the first feature
      // so we never create an orphan thread. If somehow no features exist,
      // the propose-submit button should already be disabled upstream.
      const featureName = state.pendingFeatureTag || state.features[0]?.name;
      if (!featureName) throw new Error('No feature available — create one first.');
      const features = [featureName];
      const issue = await gh.createDiscussionThread(state.token, OWNER, REPONAME, { title, text, meta, features });
      state.threadsLoadedFor = '';       // force reload next time (general threads cache)
      state.viewingFeatureLoadedFor = ''; // force reload feature page threads too
      const createdInFeature = state.pendingFeatureTag;
      state.pendingFeatureTag = null;     // consumed
      // Remember the element + instruction BEFORE we wipe them; if we're
      // building, we'll hand them to beginFirstAiTurn.
      const aiCapture = state.capture;
      const aiText = text;
      state.description = '';
      state.name = '';
      state.capture = null;

      if (thenBuild) {
        await kickOffAiForThread({
          issue: { number: issue.number, html_url: issue.html_url },
          promptText: aiText,
          capture: aiCapture,
        });
      } else {
        openThread(issue.number);
      }
    } catch (err) {
      state.authError = String(err?.message || err);
      renderPanel();
    } finally {
      state.newThreadFiling = false;
      state.filing = false;
    }
  }

  // Kick off an AI build attributed to an existing thread. The AI session
  // commits on a new feature branch and posts its summary back to the
  // thread's issue as a comment.
  async function kickOffAiForThread({ issue, promptText, capture }) {
    state._pendingIssue = issue;
    state.capture = capture || null;
    state.description = promptText;
    // Branch name: slug of the prompt, fallback to thread-<N>-<timestamp>.
    const baseSlug = slugify(promptText) || `thread-${issue.number}`;
    state.name = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
    beginFirstAiTurn();
  }

  // Invoked from the thread view composer. Uses the current thread's
  // metadata + the reply-compose text as the AI prompt, creates a new
  // branch, posts the build summary back to the thread.
  async function buildFromThread() {
    const t = state.currentThread;
    if (!t?.issue) return;
    const text = (state.threadComposeDraft || '').trim();
    if (!text) return;
    if (!requireAuth('threadView')) return;
    if (!state.openaiKey) {
      state.pendingIntent = 'thread-build';
      navigate('keyPrompt');
      return;
    }
    // Post the user's message as a comment first so the thread records
    // the intent ('let's try X'). The AI result will post as a separate
    // comment announcing the branch.
    try {
      const comment = await gh.createIssueComment(state.token, OWNER, REPONAME, t.issue.number, text);
      t.comments = [...(t.comments || []), comment];
    } catch (err) {
      console.warn('[chorus] thread build comment failed', err);
    }
    state.threadComposeDraft = '';
    const capture = t.meta ? {
      selector: t.meta.selector, text: t.meta.text, tag: t.meta.tag,
      rect: t.meta.bbox, url: t.meta.page,
    } : null;
    await kickOffAiForThread({
      issue: { number: t.issue.number, html_url: t.issue.html_url },
      promptText: text,
      capture,
    });
  }

  // Apply a freshly-picked capture as the pinned element of a thread.
  // Writes the new meta back to the issue body, updates local state, and
  // rebroadcasts so the iframe pin overlay picks up the change.
  async function applyThreadPin(number, capture) {
    if (!requireAuth('threadView')) return;
    const t = state.currentThread;
    if (!t || t.issue?.number !== number) return;
    const meta = {
      selector: capture.selector,
      text: capture.text,
      tag: capture.tag,
      page: state.currentPath || 'index.html',
      bbox: capture.rect,
    };
    try {
      await gh.updateThreadMeta(state.token, OWNER, REPONAME, number, {
        meta,
        text: t.initialText || '',
      });
      // Reflect locally so the thread view updates without a refetch.
      t.meta = meta;
      // Invalidate list caches so a trip back to threadList / featurePage
      // reloads the updated meta.
      state.threadsLoadedFor = '';
      state.viewingFeatureLoadedFor = '';
      // Update the in-memory threads list so iframe pins reflect the change
      // without a full refetch round-trip.
      const listEntry = state.threads.find((th) => th.number === number);
      if (listEntry) listEntry.meta = meta;
      broadcastThreadsToPreview();
    } catch (err) {
      state.threadsError = String(err?.message || err);
    } finally {
      renderPanel();
    }
  }

  // Strip the pinned element from a thread (keeps page + message).
  async function unpinThread() {
    if (!requireAuth('threadView')) return;
    const t = state.currentThread;
    if (!t?.issue) return;
    const number = t.issue.number;
    const meta = { page: t.meta?.page || state.currentPath || 'index.html' };
    try {
      await gh.updateThreadMeta(state.token, OWNER, REPONAME, number, {
        meta,
        text: t.initialText || '',
      });
      t.meta = meta;
      state.threadsLoadedFor = '';
      state.viewingFeatureLoadedFor = '';
      const listEntry = state.threads.find((th) => th.number === number);
      if (listEntry) listEntry.meta = meta;
      broadcastThreadsToPreview();
    } catch (err) {
      state.threadsError = String(err?.message || err);
    } finally {
      renderPanel();
    }
  }

  async function postThreadReply() {
    const t = state.currentThread;
    if (!t?.issue) return;
    const text = (state.threadComposeDraft || '').trim();
    if (!text) return;
    try {
      const comment = await gh.createIssueComment(state.token, OWNER, REPONAME, t.issue.number, text);
      t.comments = [...(t.comments || []), comment];
      state.threadComposeDraft = '';
      renderPanel();
    } catch (err) {
      console.warn('[chorus] post reply failed', err);
    }
  }

  async function promoteThread() {
    const t = state.currentThread;
    if (!t?.issue) return;
    try {
      await gh.promoteThreadToTicket(state.token, OWNER, REPONAME, t.issue.number);
      // After promotion the issue is a regular ticket. Hand off to the
      // AI flow: set up the right capture, description, and kick off
      // beginFirstAiTurn exactly as if the user had filed it fresh.
      state._pendingIssue = {
        number: t.issue.number,
        html_url: t.issue.html_url,
      };
      state.capture = t.meta ? {
        selector: t.meta.selector, text: t.meta.text, tag: t.meta.tag,
        rect: t.meta.bbox, url: t.meta.page,
      } : null;
      state.description = t.initialText || '';
      state.name = (t.issue.title || 'discussion').replace(/^discussion on\s+/i, '').slice(0, 40) || `issue-${t.issue.number}`;
      if (!state.openaiKey) {
        state.pendingIntent = 'build';
        navigate('keyPrompt');
        return;
      }
      beginFirstAiTurn();
    } catch (err) {
      console.warn('[chorus] promote failed', err);
    }
  }

  // Upvote / downvote the thread's OP (the issue itself). Optimistic:
  // bumps the local reaction count, then POSTs. On failure, rolls back.
  // GitHub's reactions API has no simple "remove my previous reaction"
  // path (you'd have to list then DELETE by id), so we don't try to
  // toggle — repeated clicks add more reactions up to what the API
  // allows, and the server dedupes when the same user casts the same
  // reaction twice.
  async function voteOnThreadOP(dir) {
    if (!requireAuth('threadView')) return;
    const t = state.currentThread;
    if (!t?.issue) return;
    const content = dir === 'up' ? '+1' : '-1';
    const r = (t.issue.reactions = t.issue.reactions || {});
    r[content] = (r[content] || 0) + 1;
    renderPanel();
    try {
      await gh.addIssueReaction(state.token, OWNER, REPONAME, t.issue.number, content);
    } catch (err) {
      r[content] = Math.max(0, (r[content] || 0) - 1);
      console.warn('[chorus] vote OP failed', err);
      renderPanel();
    }
  }

  async function voteOnThreadComment(commentId, dir) {
    if (!requireAuth('threadView')) return;
    const t = state.currentThread;
    if (!t?.comments) return;
    const c = t.comments.find((cc) => String(cc.id) === String(commentId));
    if (!c) return;
    const content = dir === 'up' ? '+1' : '-1';
    const r = (c.reactions = c.reactions || {});
    r[content] = (r[content] || 0) + 1;
    renderPanel();
    try {
      await gh.addCommentReaction(state.token, OWNER, REPONAME, commentId, content);
    } catch (err) {
      r[content] = Math.max(0, (r[content] || 0) - 1);
      console.warn('[chorus] vote comment failed', err);
      renderPanel();
    }
  }

  async function closeThread() {
    const t = state.currentThread;
    if (!t?.issue) return;
    try {
      await gh.setIssueState(state.token, OWNER, REPONAME, t.issue.number, 'closed');
      t.issue.state = 'closed';
      renderPanel();
    } catch (err) {
      console.warn('[chorus] close thread failed', err);
    }
  }

  // ── Pins on the preview iframe ────────────────────────────────
  // Send the current thread list to the inner chorus so it can render
  // clickable badges on the elements each thread references.
  function broadcastThreadsToPreview() {
    const iframe = document.getElementById('oss-kanban-preview-iframe');
    if (!iframe?.contentWindow) return;
    const payload = state.threads.map((t) => ({
      number: t.number,
      selector: t.meta?.selector || '',
      replyCount: t.comments || 0,
      title: t.issue?.title || '',
    })).filter((t) => t.selector);
    try {
      iframe.contentWindow.postMessage({ type: 'chorus:parent:render-pins', pins: payload }, '*');
    } catch {}
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
    // Per-session model override. Defaults to the settings default; user
    // can flip within a session to try a different model without changing
    // their persistent default.
    const sessionModel = s.model || state.openaiModel || DEFAULT_MODEL;
    const isCustom = !MODEL_OPTIONS.includes(sessionModel);
    const selectValue = isCustom ? '__custom__' : sessionModel;
    return `
      <label class="field ai-model-picker">
        Model
        <select data-field="ai-model">
          ${MODEL_OPTIONS.map((m) => `<option value="${esc(m)}" ${m === selectValue ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          <option value="__custom__" ${selectValue === '__custom__' ? 'selected' : ''}>Custom…</option>
        </select>
      </label>
      ${isCustom || selectValue === '__custom__' ? `
        <label class="field" style="margin-top:-4px;">
          <span class="muted-s">Custom model string</span>
          <input data-field="ai-model-custom" type="text" placeholder="e.g. gpt-5.4-turbo" value="${esc(sessionModel)}" />
        </label>
      ` : ''}
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
      <div>
        <div class="muted-s">OpenAI key</div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:3px;">
          <span class="capture">${state.openaiKey ? '●●●●●●●●' + esc(state.openaiKey.slice(-4)) : '(none set)'}</span>
          ${state.openaiKey ? `<button data-action="clear-key" class="link-btn" style="color:var(--c-danger);">Clear</button>` : ''}
        </div>
      </div>
      <label class="field">
        Default model
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
    `;
  }
  function settingsActions() {
    // Signed-in users manage sign-out from the who-strip inline link (or
    // the burger menu). Only the not-signed-in state has an action bar,
    // to house the sign-in CTA.
    if (!auth.isAuthed()) {
      return `<div class="secondary"></div><button class="primary" data-action="sign-in">Sign in with GitHub</button>`;
    }
    return null;
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
    // Overflow menu toggle + items
    on('[data-action="toggle-menu"]', 'click', (e) => {
      e.stopPropagation();
      state.menuOpen = !state.menuOpen;
      renderPanel();
    });
    const setView = (mode) => {
      state.viewMode = mode;
      storeSave('viewMode', mode);
      state.menuOpen = false;
      renderPanel();
      renderPhylogeny();
    };
    on('[data-action="set-view-tree"]', 'click', () => setView('tree'));
    on('[data-action="set-view-list"]', 'click', () => setView('list'));
    on('[data-action="goto-settings-menu"]', 'click', () => {
      state.menuOpen = false;
      state.settingsModalOpen = true;
      renderPanel();
    });
    on('[data-action="sign-in-menu"]', 'click', () => {
      state.menuOpen = false;
      startDeviceFlow();
    });
    on('[data-action="sign-out-menu"]', 'click', () => {
      state.menuOpen = false;
      signOut();
    });

    // Features
    on('[data-action="features-open-create"]', 'click', () => {
      if (!requireAuth('features')) return;
      state.featuresCreateOpen = true;
      state.featuresCreateError = null;
      renderPanel();
      // Focus the name input for fast entry.
      setTimeout(() => {
        panelEl?.querySelector('[data-field="features-create-name"]')?.focus();
      }, 0);
    });
    on('[data-action="features-cancel-create"]', 'click', () => {
      state.featuresCreateOpen = false;
      state.featuresCreateError = null;
      state.featuresCreateDraft = { name: '', description: '' };
      renderPanel();
    });
    on('[data-action="features-submit-create"]', 'click', submitCreateFeature);
    const featuresSearchInput = panelEl.querySelector('[data-field="features-search"]');
    featuresSearchInput?.addEventListener('input', (e) => {
      state.featuresSearch = e.target.value;
      // Cheap re-render — filter is client-side, no network involved.
      const panel = panelEl;
      // Only re-render the body-grid portion to avoid losing search-input focus.
      // Simplest correct approach: full renderPanel, then refocus + restore caret.
      const caret = e.target.selectionStart;
      renderPanel();
      const again = panelEl?.querySelector('[data-field="features-search"]');
      if (again) {
        again.focus();
        try { again.setSelectionRange(caret, caret); } catch {}
      }
    });
    const featuresNameInput = panelEl.querySelector('[data-field="features-create-name"]');
    featuresNameInput?.addEventListener('input', (e) => {
      state.featuresCreateDraft.name = e.target.value;
      // Re-render only if the slug preview or can-create disabled state changed.
      const prevSlug = slugifyFeatureNameClient(state.featuresCreateDraft.name);
      renderPanel();
      const again = panelEl?.querySelector('[data-field="features-create-name"]');
      if (again) {
        again.focus();
        const pos = Math.min(e.target.value.length, again.value.length);
        try { again.setSelectionRange(pos, pos); } catch {}
      }
    });
    const featuresDescInput = panelEl.querySelector('[data-field="features-create-description"]');
    featuresDescInput?.addEventListener('input', (e) => {
      state.featuresCreateDraft.description = e.target.value;
      // No re-render needed — nothing visible depends on this field mid-keystroke.
    });
    panelEl.querySelectorAll('[data-action="open-feature"]').forEach((el) => {
      el.addEventListener('click', () => {
        const name = el.dataset.feature;
        const feature = state.features.find((f) => f.name === name);
        if (feature) openFeature(feature);
      });
    });

    // Feature page: "+ New thread" → propose with the current feature
    // carried through so the resulting thread is tagged. Picking is
    // optional; we don't auto-enter pick mode.
    on('[data-action="feature-new-thread"]', 'click', () => {
      if (!requireAuth('propose')) return;
      if (state.viewingFeature) state.pendingFeatureTag = state.viewingFeature.name;
      navigate('propose');
    });

    // Browse (list view)
    panelEl.querySelectorAll('.branch').forEach((el) => {
      el.addEventListener('click', () => selectBranch(el.dataset.branch));
    });
    on('[data-action="goto-propose"]', 'click', () => {
      if (!requireAuth('propose')) return;
      navigate('propose');
    });

    // Propose (thread compose): single textarea. On transitions between
    // empty and non-empty we re-render so the action-bar buttons update
    // (disabled state depends on content); between transitions we just
    // keep typing.
    const descInput = panelEl.querySelector('[data-field="description"]');
    descInput?.addEventListener('input', (e) => {
      const prev = (state.description || '').trim().length > 0;
      const now = e.target.value.trim().length > 0;
      state.description = e.target.value;
      if (prev !== now) {
        renderPanel();
        const again = panelEl?.querySelector('[data-field="description"]');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }
    });
    on('[data-action="pick"]', 'click', () => state.pickMode ? exitPickMode() : enterPickMode());
    on('[data-action="clear-capture"]', 'click', () => { state.capture = null; renderPanel(); });
    const proposeFeatureSelect = panelEl.querySelector('[data-field="propose-feature"]');
    proposeFeatureSelect?.addEventListener('change', (e) => {
      state.pendingFeatureTag = e.target.value || null;
    });
    on('[data-action="start-discussion"]', 'click', () => startDiscussion(false));
    on('[data-action="start-and-build"]', 'click', () => startDiscussion(true));
    on('[data-action="thread-build"]', 'click', buildFromThread);
    // Legacy actions kept for backwards compat if any embed uses them:
    on('[data-action="file-and-build"]', 'click', () => startDiscussion(true));
    on('[data-action="file-only"]', 'click', () => startDiscussion(false));

    // Discussions
    on('[data-action="goto-features"]', 'click', () => {
      state.pendingFeatureTag = null; // leaving any specific feature context
      navigate('features');
      loadFeatures();
    });
    on('[data-action="goto-features-menu"]', 'click', () => {
      state.menuOpen = false;
      state.pendingFeatureTag = null;
      navigate('features');
      loadFeatures();
    });
    on('[data-action="goto-threads"]', 'click', () => {
      navigate('threadList');
      loadThreads();
    });
    on('[data-action="goto-propose-discuss"]', 'click', () => {
      if (!requireAuth('propose')) return;
      // Picking is optional on the propose screen; don't auto-enter the
      // picker here either. Users can pin from propose or later from the
      // thread view.
      navigate('propose');
    });
    panelEl.querySelectorAll('[data-action="open-thread"]').forEach((el) => {
      el.addEventListener('click', () => openThread(Number(el.dataset.number)));
    });
    const replyTa = panelEl.querySelector('[data-field="thread-reply"]');
    replyTa?.addEventListener('input', (e) => {
      const prev = (state.threadComposeDraft || '').trim().length > 0;
      const now = e.target.value.trim().length > 0;
      state.threadComposeDraft = e.target.value;
      if (prev !== now) {
        // Refresh the action bar without losing focus.
        renderPanel();
        const again = panelEl?.querySelector('[data-field="thread-reply"]');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }
    });
    on('[data-action="post-thread-reply"]', 'click', postThreadReply);
    on('[data-action="promote-thread"]', 'click', promoteThread);
    on('[data-action="close-thread"]', 'click', closeThread);
    on('[data-action="pin-thread"]', 'click', () => {
      if (!requireAuth('threadView')) return;
      const t = state.currentThread;
      if (!t?.issue) return;
      state.pinningThreadNumber = t.issue.number;
      renderPanel(); // show "Picking…" state on the button
      enterPickMode();
    });
    on('[data-action="unpin-thread"]', 'click', unpinThread);

    // Thread OP vote arrows
    panelEl.querySelectorAll('[data-action="vote-op"]').forEach((el) => {
      el.addEventListener('click', () => voteOnThreadOP(el.dataset.dir));
    });
    // Comment vote arrows
    panelEl.querySelectorAll('[data-action="vote-comment"]').forEach((el) => {
      el.addEventListener('click', () => voteOnThreadComment(el.dataset.commentId, el.dataset.dir));
    });

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
    // Per-session model picker (separate from the default in Settings)
    const aiModelSelect = panelEl.querySelector('[data-field="ai-model"]');
    aiModelSelect?.addEventListener('change', (e) => {
      if (!state.ai) return;
      const v = e.target.value;
      if (v === '__custom__') {
        state.ai.model = state.ai.model || state.openaiModel || DEFAULT_MODEL;
        renderPanel();
        panelEl?.querySelector('[data-field="ai-model-custom"]')?.focus();
      } else {
        state.ai.model = v;
        renderPanel();
      }
    });
    const aiModelCustom = panelEl.querySelector('[data-field="ai-model-custom"]');
    aiModelCustom?.addEventListener('input', (e) => {
      if (!state.ai) return;
      const v = e.target.value.trim();
      if (v) state.ai.model = v;
    });

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
      else if (intent === 'start-and-build') startDiscussion(true);
      else if (intent === 'thread-build') buildFromThread();
      else navigate('features', { reset: true });
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
    on('[data-action="goto-settings"]', 'click', () => {
      state.settingsModalOpen = true;
      renderPanel();
    });
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
    const capture = {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      text: (el.innerText || '').trim().slice(0, 200),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      url: location.href,
    };
    // If the pick was initiated from the thread view's "Pin to element"
    // affordance, route the capture straight to updating that thread's meta
    // rather than populating state.capture (which drives the propose flow).
    const pinningNumber = state.pinningThreadNumber;
    state.pickMode = false;
    overlayEl?.remove(); overlayEl = null;
    hintEl?.remove(); hintEl = null;
    document.removeEventListener('mousemove', onPickHover, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
    if (pinningNumber) {
      state.pinningThreadNumber = null;
      openPanel();            // re-open the panel on threadView
      applyThreadPin(pinningNumber, capture).catch(() => {});
    } else {
      state.capture = capture;
      openPanel();
    }
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
          else if (intent === 'features') { navigate('features', { reset: true }); loadFeatures(); }
          else navigate('features', { reset: true });
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
      // Preserved so continueAi can create the branch on a later turn if
      // the first turn produced text-only output with no write_file calls.
      plannedSlug: slug,
      workingRef: null,
      previewUrl: null,
      followUpDraft: '',
      error: null,
      // Per-session model. Defaults to the user's configured default;
      // the AI screen has a dropdown that mutates it for this session only.
      model: state.openaiModel || DEFAULT_MODEL,
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
        apiKey: state.openaiKey, model: state.ai?.model || state.openaiModel || DEFAULT_MODEL,
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

  async function startRefine() {
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
      plannedSlug: branch.replace(/^feature\//, ''),
      workingRef: branch,
      previewUrl: previewUrlFor(branch),
      followUpDraft: '',
      error: null,
      // Per-session model; defaults to settings default, changeable inline.
      model: state.openaiModel || DEFAULT_MODEL,
      // Rebuilt history from issue comments so the AI has context across
      // sessions (user closes tab Monday, comes back Thursday to refine).
      priorContext: '',
    };
    if (issue) {
      state.ai.issueHtmlUrl = issue.html_url;
    }
    // Pre-show the preview so user sees the current branch state.
    // Resolve the SHA asynchronously so we hit rawcdn (immutable) not
    // raw.githack (10-min edge cache).
    showBranchPreview(branch).then((url) => { if (state.ai) state.ai.previewUrl = url; });
    navigate('ai');
    // Fetch issue comments asynchronously to build prior-context. The AI
    // screen renders immediately; when this resolves the next refine turn
    // will include history automatically.
    if (issue?.number) {
      safe(async () => {
        const comments = await gh.listIssueComments(state.token, OWNER, REPONAME, issue.number);
        if (!state.ai) return;
        state.ai.priorContext = buildPriorContext(issue, comments);
      });
    }
  }

  async function continueAi() {
    if (!state.ai) return;
    const followUp = (state.ai.followUpDraft || '').trim();
    if (!followUp) return;
    // state.ai.branch may be null if the first turn produced text only (no
    // write_file calls, so nothing was committed and no branch was created).
    // In that case, continueAi is effectively still a "first commit" —
    // commitAndSurface will lazily create the branch from plannedSlug when
    // it has something to commit.
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
        : { userPrompt: buildRefinePrompt(state.ai.branch, followUpWithCapture, state.ai.priorContext || '') };
      const result = await runAiSession({
        apiKey: state.openaiKey, model: state.ai?.model || state.openaiModel || DEFAULT_MODEL,
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
      state.ai.summary = result.summary || '(no changes this turn — the AI responded with text only. Refine with an explicit instruction and try again.)';
      renderPanel();
      return;
    }
    state.ai.status = 'committing';
    renderPanel();
    // A "first commit" is any commit where the branch hasn't been created yet —
    // regardless of whether this is turn 1 or turn N. Earlier text-only turns
    // leave state.ai.branch null until something actually gets written.
    const isFirstCommit = !state.ai.branch;
    const branch = isFirstCommit
      ? `feature/${state.ai.plannedSlug || slugify(state.name) || 'issue-' + (issue?.number || Date.now().toString(36))}`
      : state.ai.branch;
    const commitMessage = result.summary
      ? `${result.summary}\n\nRefs #${issue?.number ?? ''}`
      : `AI edits (turn ${state.ai.turn})`;
    const commitRes = await gh.commitFiles(state.token, OWNER, REPONAME, {
      branch,
      // Only create-from-default when the branch doesn't exist yet.
      startFrom: isFirstCommit ? (defaultBranch || state.ai.workingRef || 'main') : undefined,
      message: commitMessage, files: state.ai.staged,
    });
    // Update our SHA cache to the brand-new commit so subsequent
    // showBranchPreview / previewUrlFor calls use the immutable rawcdn URL.
    if (commitRes?.sha) branchShaCache.set(branch, { sha: commitRes.sha, fetchedAt: Date.now() });
    const previewPath = state.currentPath || 'index.html';
    const previewUrl = buildPreviewUrl({ branch, sha: commitRes?.sha, path: previewPath });
    if (issue?.number) {
      const reasoning = summariseReasoning(state.ai.events);
      const body = isFirstCommit
        ? [
            `AI built a candidate on branch \`${branch}\`.`,
            '',
            `Preview: ${previewUrl}`,
            result.summary ? `\nSummary: ${result.summary}` : '',
            reasoning ? `\n<details><summary>What the AI did (turn ${state.ai.turn})</summary>\n\n${reasoning}\n</details>` : '',
          ].filter(Boolean).join('\n')
        : [
            `Turn ${state.ai.turn} on \`${branch}\`${result.summary ? ': ' + result.summary : ''}`,
            '',
            `Preview: ${previewUrl}`,
            reasoning ? `\n<details><summary>What the AI did</summary>\n\n${reasoning}\n</details>` : '',
          ].filter(Boolean).join('\n');
      await safe(() => gh.createIssueComment(state.token, OWNER, REPONAME, issue.number, body));
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

  // Build a condensed context summary from the original issue + all AI
  // comments on it. The AI reads this as part of the refine prompt so it
  // has memory across browser sessions without us persisting client state.
  function buildPriorContext(issue, comments) {
    const lines = [];
    if (issue?.title) lines.push(`Original ticket: ${issue.title}`);
    if (issue?.body) {
      const bodyTrimmed = issue.body.replace(/\n{3,}/g, '\n\n').trim().slice(0, 500);
      if (bodyTrimmed) lines.push(`Ticket description: ${bodyTrimmed}`);
    }
    const aiComments = (comments || []).filter((c) =>
      // Pick out the comments we posted from commitAndSurface. They start
      // with either "AI built a candidate" or "Turn N on".
      /^AI built a candidate|^Turn \d+ on/.test(c.body || '')
    );
    if (aiComments.length) {
      lines.push('');
      lines.push(`Prior AI turns on this branch (${aiComments.length}):`);
      for (const c of aiComments) {
        // Unwrap the <details><summary>…</summary> block so the reasoning
        // INSIDE it becomes flat context for the next AI. We drop only the
        // markdown tags, not the content — the whole point of the richer
        // summariser is for this to be useful downstream.
        const body = (c.body || '')
          .replace(/<details>\s*<summary>[^<]*<\/summary>\s*/g, '')
          .replace(/<\/details>/g, '')
          .trim();
        lines.push('');
        lines.push(body);
      }
    }
    return lines.join('\n');
  }

  // Render an AI session's event log into markdown for the GitHub issue
  // comment. This block is then re-parsed by buildPriorContext on future
  // refine turns, so it has to carry enough information for the next AI
  // to understand what was done and why — not just what files changed.
  //
  // Design:
  // - assistant_text kept IN FULL (that's where the reasoning lives)
  // - tool calls shown with a one-line arg preview (truncated args, not
  //   write_file bodies — those would blow out token budgets)
  // - write_file paths always called out clearly so subsequent turns can
  //   see 'file X was edited' without parsing the args
  // - errors/stops surfaced so future turns don't repeat a known failure
  function summariseReasoning(events) {
    if (!events?.length) return '';
    const lines = [];
    for (const e of events) {
      if (e.type === 'assistant_text' && e.text) {
        // Full reasoning text. Newlines preserved via blockquote so the
        // markdown keeps its structure inside the <details> block.
        const quoted = e.text.trim().split('\n').map((l) => `> ${l}`).join('\n');
        lines.push('**Reasoning:**');
        lines.push(quoted);
      } else if (e.type === 'tool_call') {
        if (e.name === 'write_file') {
          const path = e.args?.path || '(no path)';
          const bytes = (e.args?.content || '').length;
          lines.push(`- **edited** \`${path}\` (${bytes} bytes)`);
        } else if (e.name === 'read_file') {
          lines.push(`- read \`${e.args?.path || '(no path)'}\``);
        } else if (e.name === 'list_files') {
          lines.push(`- listed files${e.args?.ref ? ` at ref \`${e.args.ref}\`` : ''}`);
        } else {
          const argPreview = shortArgs(e.args).slice(0, 200);
          lines.push(`- \`${e.name}(${argPreview})\``);
        }
      } else if (e.type === 'tool_error') {
        lines.push(`  - ⚠ error: ${String(e.error).slice(0, 200)}`);
      } else if (e.type === 'finish') {
        lines.push(`- ✓ **finished:** ${e.summary}`);
      } else if (e.type === 'stopped_without_finish') {
        lines.push(`- ⚠ stopped without calling finish`);
      } else if (e.type === 'iteration_limit') {
        lines.push(`- ⚠ hit iteration limit`);
      }
    }
    return lines.join('\n');
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
    const workingBranch = `feature/${slugify(state.name)}`;
    return [
      `Feature: ${state.name}`,
      `Ticket: ${description.trim()}`,
      '',
      `Issue number: ${issue.number}`,
      `Repo default branch: ${defaultBranch}`,
      `Target branch (will be created with your changes): ${workingBranch}`,
      '',
      `IMPORTANT: the target branch \`${workingBranch}\` DOES NOT EXIST YET — it will be created from ${defaultBranch} when your staged writes are committed at the end. For this turn, read from \`${defaultBranch}\` (which is what list_files and read_file default to when you omit the \`ref\` argument). Do NOT pass \`ref: "${workingBranch}"\` — it will 404.`,
      captureHint(capture),
      '',
      'Use list_files first to see what is in the repo. Read relevant files, then stage changes with write_file, then call finish.',
    ].join('\n');
  }

  function buildRefinePrompt(branch, followUp, priorContext = '') {
    return [
      `You are continuing work on an existing feature branch: \`${branch}\`.`,
      '',
      `Use list_files and read_file (they default to the ${branch} branch) to see the current state.`,
      `Then apply the requested change by staging edits with write_file, and call finish when done.`,
      '',
      priorContext ? `Context from prior turns on this branch (for reference, don't re-do this work):\n${priorContext}\n` : '',
      `User's request:`,
      followUp,
    ].filter(Boolean).join('\n');
  }

  async function executeTool(name, args) {
    const workingRef = state.ai?.workingRef || 'main';
    // The first turn runs before the feature branch exists — requests to
    // `ref: feature/foo` 404. Rather than burn an AI turn correcting that,
    // transparently fall back to the working ref (usually the default
    // branch) and tell the AI what we did.
    const tryWithFallback = async (fn, ref) => {
      try {
        return { value: await fn(ref) };
      } catch (err) {
        const is404 = String(err.message || err).includes(' 404');
        if (!is404 || ref === workingRef) throw err;
        const value = await fn(workingRef);
        return { value, fellBackFrom: ref, fellBackTo: workingRef };
      }
    };
    if (name === 'list_files') {
      const ref = args.ref || workingRef;
      const { value, fellBackFrom, fellBackTo } = await tryWithFallback(
        (r) => gh.listTree(state.token, OWNER, REPONAME, r),
        ref,
      );
      const files = (value.tree || []).filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 }));
      if (fellBackFrom) {
        return { files, _note: `ref "${fellBackFrom}" does not exist yet; listed from "${fellBackTo}" instead` };
      }
      return files;
    }
    if (name === 'read_file') {
      const ref = args.ref || workingRef;
      const { value, fellBackFrom, fellBackTo } = await tryWithFallback(
        (r) => gh.readFile(state.token, OWNER, REPONAME, args.path, r),
        ref,
      );
      if (value === null) return { error: `File not found: ${args.path}` };
      if (fellBackFrom) {
        return { content: value, _note: `ref "${fellBackFrom}" does not exist yet; read from "${fellBackTo}" instead` };
      }
      return value;
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
  // Used only by non-authed fallbacks now — when signed in, the identity
  // lives in the settings modal's title strip instead of a body row.
  function whoHtml() {
    if (!auth.isAuthed() || !state.user) {
      return `<div class="who">Not signed in · <button class="link-btn" data-action="sign-in">Sign in with GitHub</button></div>`;
    }
    return '';
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
      state.threadsLoadedFor = ''; // page changed → threads cache stale
      if (state.open) renderPanel();
      if (state.token && configOK()) loadThreads().catch(() => {});
    } else {
      // Same path but inner chorus just (re)booted — rebroadcast pins.
      // Slight delay so the inner's bootPreviewMode message listener is
      // definitely installed before we post.
      setTimeout(broadcastThreadsToPreview, 100);
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
      // If the capture is the result of the user explicitly picking an
      // element to start a new thread (i.e. they're NOT already in a
      // session where they'd want the element attached — ai, feature,
      // threadView, propose), land them on the thread compose screen so
      // the flow reads as 'pick → write comment → post'.
      const composableScreens = ['browse', 'threadList'];
      if (composableScreens.includes(state.screen)) {
        navigate('propose');
      }
    }
    if (d.type === 'chorus:preview:cancelled') {
      state.pickMode = false;
      openPanel();
    }
    if (d.type === 'chorus:preview:thread-open') {
      if (!state.open) openPanel();
      openThread(d.number);
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
