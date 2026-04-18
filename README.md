# Chorus

Collaborative, AI-assisted, branch-by-branch evolution of a live website, governed by community voting.

**Status:** early / experimental. Not yet a product.

## What it is

Drop a script onto a static site. Visitors click elements on the page, describe changes they want, and an AI proposes the change as a new git branch. Every branch is previewable via jsDelivr. Community votes via GitHub reactions. A GitHub Action auto-merges branches that cross a vote threshold.

Everything runs on GitHub as the substrate — issues for discussion, reactions for votes, branches for proposed changes, Actions for governance. No custom backend for most flows; one Cloudflare Worker for GitHub's OAuth device-flow CORS.

## Packages

```
packages/
  widget/       # The drop-in widget users embed on their site
  switcher/     # The branch/feature switcher that lives alongside
  shared/       # Shared utilities (preview iframe, auth state)
  governance/   # Rules + GitHub Action runner for auto-merge
  auth-proxy/   # Cloudflare Worker (or Node) proxy for GitHub OAuth
```

## Embedding

```html
<script type="module"
  id="oss-kanban-widget"
  src="https://cdn.jsdelivr.net/gh/MarcusRobbins/chorus@main/packages/widget/widget.js"
  data-github-client-id="YOUR_OAUTH_APP_CLIENT_ID"
  data-github-repo="owner/repo"
  data-github-auth-proxy="https://your-worker.workers.dev"></script>

<script type="module"
  id="oss-kanban-switcher"
  src="https://cdn.jsdelivr.net/gh/MarcusRobbins/chorus@main/packages/switcher/switcher.js"
  data-github-repo="owner/repo"></script>
```

## Try locally

```bash
npx serve .
# open http://localhost:5173/spike/
```

## License

MIT.
