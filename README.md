# Chorus

Collaborative, AI-assisted, branch-by-branch evolution of a live website, governed by community voting.

**Status:** early / experimental. Not yet a product.

## What it is

Drop a script onto a static site. Visitors click elements on the page, describe changes they want, and an AI proposes the change as a new git branch. Every branch is previewable via rawcdn.githack.com pinned to its tip commit SHA. Community votes via GitHub reactions. A GitHub Action auto-merges branches that cross a vote threshold.

Everything runs on GitHub as the substrate — issues for discussion, reactions for votes, branches for proposed changes, Actions for governance. No custom backend for most flows; one Cloudflare Worker for GitHub's OAuth device-flow CORS.

## Packages

```
packages/
  chorus/       # The unified chorus panel (trigger + all screens)
  shared/       # Shared utilities (preview iframe, auth state)
  widget/       # GitHub + OpenAI clients used by chorus
  governance/   # Rules + GitHub Action runner for auto-merge
  auth-proxy/   # Cloudflare Worker proxy for GitHub OAuth device flow
```

## Embedding

Minimum viable embed:

```html
<script type="module"
  id="chorus"
  src="https://cdn.jsdelivr.net/gh/owner/chorus@COMMIT_SHA/packages/chorus/app.js"
  data-github-client-id="YOUR_OAUTH_APP_CLIENT_ID"
  data-github-repo="owner/repo"
  data-github-auth-proxy="https://your-worker.workers.dev"></script>
```

Pin the script to a commit SHA rather than `@main` — jsDelivr caches the SHA form indefinitely (immutable) whereas branch URLs are cached for up to 10 minutes and serve stale code. The pattern OSSKanban uses: a tiny loader resolves the latest `main` commit via the GitHub API, then injects the `@SHA` URL.

### Attributes

Required:

| Attribute | Value | What it does |
|---|---|---|
| `data-github-client-id` | `Ov23li...` | OAuth App client ID (from GitHub → Settings → Developer Settings → OAuth Apps). Controls what the "Sign in with GitHub" flow authorises. |
| `data-github-repo` | `owner/repo` | The repo chorus edits. Issues, branches, comments all go here. |
| `data-github-auth-proxy` | `https://...workers.dev` | Your deployed `auth-proxy` Cloudflare Worker. Needed because GitHub's device-flow endpoints reject browser origins — the Worker adds CORS. |

Optional:

| Attribute | Value | What it does |
|---|---|---|
| `data-auto-preview` | `"true"` | Open a branch-preview iframe on page boot (defaults to `main`). Without this, the iframe only appears when the user picks a branch. |
| `data-chorus-meta` | `"true"` | Pin the preview iframe to windowed mode always. Only for the chorus-on-chorus demo where outer and inner chorus pills would otherwise collide at bottom-right. |
| `data-preview-mode` | `"full"` | Force chorus to run its full UI even when inside an iframe (normally it runs a silent preview-mode handler inside iframes). Only for chorus-on-chorus. |
| `data-openai-model` | `"gpt-5.4"` | Default model for AI edits. User can override per-session in Settings. Unknown models 404 at OpenAI. |
| `data-debug` | `"true"` | Enables `[chorus] ...` console logs. Useful while setting up. |

### Preview iframe sizing

The preview iframe switches between two modes based on the chorus panel state:

- **Panel closed** → full viewport. Branch preview reads as "the site".
- **Panel open** → windowed (62vw × 66vh, top-left). Panel and preview both visible.

On the chorus-on-chorus demo (`data-chorus-meta="true"`) the iframe is pinned to windowed always.

## Auth flow

Chorus uses GitHub's [OAuth Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow). This avoids needing a redirect URI (awkward for an embedded widget) but requires a tiny CORS proxy because GitHub's device endpoints reject browser-origin requests.

`packages/auth-proxy/` is a Cloudflare Worker that forwards `/device/code` and `/oauth/token` requests. Deploy it once per OAuth app.

Tokens live in `sessionStorage`; they're cleared when the tab closes. No server-side session, no database.

## AI edits

When a user files a change ticket, chorus:

1. Creates a GitHub issue with the description + annotated element metadata.
2. Spawns a new branch `feature/<slug>`.
3. Hands the issue + repo tree to the user's OpenAI model via tool-calling (`list_files`, `read_file`, `write_file`, `finish`).
4. Atomically commits whatever files the model staged via the Git Data API — one commit per turn.
5. Preview URL (SHA-pinned rawcdn.githack) appears in the AI panel and as an issue comment.

The user can refine in the same session — follow-up instructions go to the AI with the full prior message history.

## Governance / auto-merge

`packages/governance/` contains the rules + a GitHub Action (`workflow.yml`) that runs on issue comment + reaction events. Default rules:

- `+1` reactions on the feature branch's issue count as votes.
- Threshold to auto-merge is tunable per-repo.
- Author of the ticket counts, but at lower weight than other voters.

Communities can override rules in `governance/rules.mjs` on their fork.

## Try it

- **OSSKanban demo** — [marcusrobbins.github.io/OSSKanban](https://marcusrobbins.github.io/OSSKanban/) — a minimal static React page with chorus embedded. File tickets, watch AI branches appear, vote with GitHub reactions.
- **Chorus-on-chorus** — [marcusrobbins.github.io/chorus/test-site](https://marcusrobbins.github.io/chorus/test-site/) — chorus editing its own source. Outer chorus files tickets against `MarcusRobbins/chorus`; the windowed iframe shows the branch's version of the tool.

## Run locally

```bash
npx serve .
# open http://localhost:3000/test-site/
```

You'll need your own OAuth app, auth-proxy Worker deploy, and OpenAI key entered via the chorus UI.

## License

MIT.
