# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Layout

```
apps/app/          Vite SPA — the main capture app (GitHub Pages)
services/scraper/  Hono/Node.js scraper proxy service (fly.io)
```

## Commands (run from repo root)

```bash
pnpm dev                # start Vite (:5174) + scraper (:8080) in parallel
pnpm build              # build both packages in parallel
pnpm test               # run all tests (playwright e2e + scraper unit)
pnpm test:ui            # playwright interactive UI
pnpm typecheck          # tsc --noEmit across all packages in parallel
pnpm deploy:app         # build + gh-pages push (GitHub Pages)
pnpm deploy:scraper     # build + fly deploy (fly.io)
```

To run tests for one package only:

```bash
pnpm --filter @obsidian-capture/app test
pnpm --filter @obsidian-capture/scraper test
```

## App architecture (`apps/app/`)

Single-page Vite/TypeScript app, no framework. Config lives entirely in the URL.

### Routing (`src/main.ts`)

- `?instances=` present → `renderUse()`
- `?mode=configure` or no `?instances=` → `renderConfigure()`
- `?mode=bm` on top of Use params → bookmarklet iframe mode

### URL / Config params

| Param       | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `instances` | Unicode-safe base64-encoded JSON array `{vault, folder?, name?, emoji?, canvas?, props?}[]` |
| `mode`      | `configure` or `bm` (bookmarklet iframe)                                                    |
| `su`        | Scraper service URL (falls back to `VITE_SCRAPER_URL`)                                      |
| `ss`        | Scraper bearer secret                                                                       |

Legacy single-instance params (`v`, `f`, `n`, `e`, `canvas`, `props`) are still decoded for configure-view prefill but never generated.

### Bookmarklet flow

1. Bookmarklet injects a fullscreen `<iframe>` overlay.
2. Before building the iframe src, it: strips `<script>`/`<style>` tags; for YouTube, extracts a compact subset of `window.ytInitialData`. JSON-encodes `{ html, yt? }` and base64-encodes into the fragment: `<useUrl>&mode=bm&url=<encoded>&title=<encoded>#<b64>`.
3. `use.ts` decodes the fragment, extracts content (YouTube via `extractFromYtData`/`extractYouTubeContent`; others via Readability). `url`/`title` params use `safeDecodeUri()` (double-`decodeURIComponent`) for iOS Shortcuts compatibility.
4. On Save, posts `{ type: 'obsidianUri', url }` to parent (for tests), then navigates via `window.location.href = obsidian://new?...`.

### Scraper

`src/lib/scraper.ts` — `scrapeUrl(url, config)` fetches HTML via the proxy service. Auto-scrape fires 600ms after URL detected in the `what` field; `#btnFetch` for manual. YouTube detection checks both `result.url` and the original URL passed to `doScrape()`.

### Note output

- **Markdown**: YAML frontmatter + body + `Source:` URL. Filename: `YYYY-MM-DD HH.mm <slug>.md`.
- **Canvas**: JSON with link/text nodes. Filename: `<slug>.canvas` (no timestamp).
- `RESERVED_PROP_KEYS = {'created','what','who','why'}` — custom props with these keys are skipped.

### Update check

`main.ts` fetches `./version.json` in production and shows a refresh banner if the git hash differs from `__APP_VERSION__`.

## Scraper service (`services/scraper/`)

Hono/Node.js proxy. `GET /fetch?url=<url>` returns `{ url, html, title }`. Reads `SCRAPER_SECRET` and `ALLOWED_ORIGIN` env vars dynamically (set via `fly secrets set`). Port 8080. Deployed to fly.io (`fly.toml` in package dir).

## Tests

Tests should be colocated with the code they are testing. The exception is e2e tests, which are in an e2e folder.

Always ensure all tests pass before commiting code.

## Commits

Write commit messages, PR titles, and PR descriptions as a humble but experienced engineer. Keep it casual, but terse. Avoid listing out implementation details. Highlight non-obvious implementation choices.
