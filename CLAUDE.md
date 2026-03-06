# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # dev server at http://localhost:5174
pnpm build        # production build → dist/
pnpm run deploy   # build + push to gh-pages branch (GitHub Pages)

pnpm test                                          # run all tests
pnpm test test/bookmarklet.spec.js                 # run one file
pnpm test -- --reporter=line                       # compact output
pnpm test:ui                                       # interactive UI mode
```

## Architecture

Single-page Vite/TypeScript app with no framework. All DOM manipulation is vanilla TS. Deployed to GitHub Pages; config lives entirely in the URL so bookmarks and home screen shortcuts carry all settings without any backend.

### Routing (`src/main.ts`)

- `?mode=configure` or no `?v=` param → `renderConfigure()`
- `?v=<vault>` present → `renderUse()`
- `?mode=bm` added on top of Use view params → bookmarklet iframe mode

### URL / Config params

| Param | Meaning |
|-------|---------|
| `v` | Vault name |
| `f` | Target folder |
| `n` | Shortcut/bookmarklet display name |
| `e` | Emoji for iOS home screen icon |
| `canvas` | `1` = canvas mode |
| `props` | base64-encoded JSON `{k, v, type}[]` for custom frontmatter |
| `mode` | `configure` or `bm` (bookmarklet iframe) |

`src/lib/config.ts` encodes/decodes between the `Config` interface and URL params.

### Bookmarklet flow

1. User clicks the bookmarklet on any page → `bookmarkletFn` in `src/lib/bookmarklet.ts` injects a fullscreen overlay `<div>` containing an `<iframe>`.
2. Before building the iframe src, the bookmarklet: strips all `<script>`/`<style>` tags from `outerHTML`; for YouTube pages, extracts a compact subset of `window.ytInitialData` (only the renderers needed for title/channel/description). It then JSON-encodes `{ html, yt? }` and base64-encodes it into the iframe src fragment: `<useUrl>&mode=bm&url=<encoded>&title=<encoded>#<b64>`.
3. `use.ts` reads `location.hash`, base64-decodes it, JSON-parses the payload, and extracts content: YouTube → `extractFromYtData(yt)` (or `extractYouTubeContent(html)` fallback); all others → `extractContent(html)` via `@mozilla/readability`. The `url` and `title` query params are decoded with `safeDecodeUri()` (double-`decodeURIComponent`) to handle iOS Shortcuts' URL-type conversion re-encoding `%` sequences.
4. On Save, `use.ts` posts `{ type: 'obsidianUri', url }` to the parent (for testing), then navigates via `window.location.href = obsidian://new?...`.
5. The parent closes the overlay on `{ type: 'close' }`.

The same fragment schema (`{ html, yt? }` base64 in the URL fragment) is used by the iOS Shortcut path — the Shortcut fetches the page HTML, base64-encodes it as raw HTML (not JSON), and the app's `JSON.parse` fallback in `use.ts` handles it transparently.

### YouTube extraction (`src/lib/content.ts`)

`ytInitialData` is extracted by finding the `var ytInitialData = ` marker in raw HTML and evaluating it with `new Function()`. This handles both desktop (object literal) and mobile (JS string with hex escapes like `'\x7b...\x7d'`) forms. Desktop uses `twoColumnWatchNextResults`; mobile uses `singleColumnWatchNextResults` with description in `engagementPanels[video-description-ep-identifier]`.

### Note output

- **Markdown**: YAML frontmatter (`created`, `what`, `who`, custom props, `why`) + body text from extraction + `Source:` URL. Filename: `YYYY-MM-DD HH.mm <title slug>.md`.
- **Canvas**: JSON with a `link` node (if URL present) and/or `text` node side-by-side. Filename: `<title slug>.canvas` (no timestamp).
- `RESERVED_PROP_KEYS = {'created','what','who','why'}` — custom props with these keys are silently skipped.

### Update check

In production, `main.ts` fetches `./version.json` (emitted by a Vite plugin from the current git hash) and shows a refresh banner if it differs from the build-time constant `__APP_VERSION__`.

### Service worker

`sw.js` (in `public/`) is registered in production only. Playwright config sets `serviceWorkers: 'block'` so it does not interfere with `page.route()` handlers in tests.

## Tests

- `test/smoke.spec.js` — UI-level tests: configure view, stale notice, boolean props, use view basics.
- `test/bookmarklet.spec.js` — E2E bookmarklet flow: serves fixture HTML at its real YouTube URL, injects the bookmarklet, waits for content extraction, clicks Save, and asserts the captured `obsidian://` URI.

Fixtures live in `test/fixtures/`. The `obsidianUri` postMessage (sent by `use.ts` before navigating) is how tests capture the final URI without interception tricks — `page.route` does not intercept custom-protocol navigations and `Location.prototype.href` setter override does not work in Blink.
