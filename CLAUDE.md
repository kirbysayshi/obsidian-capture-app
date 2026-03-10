# CLAUDE.md

## Layout

```
apps/app/          Vite SPA — main capture app (GitHub Pages)
services/scraper/  Hono/Node.js scraper proxy (fly.io)
```

## Commands (run from repo root)

```bash
pnpm dev                # Vite :5174 + scraper :8080
pnpm build
pnpm test               # playwright e2e + scraper unit
pnpm test:ui            # playwright interactive UI
pnpm typecheck
pnpm deploy:app         # build + gh-pages push
pnpm deploy:scraper     # build + fly deploy
pnpm --filter @obsidian-capture/app test
pnpm --filter @obsidian-capture/scraper test
```

## Architecture

Single-page Vite/TypeScript app, no framework. **All config lives in the URL.**

### Routing

- `?instances=` present → use/capture view
- otherwise → configure view
- `?mode=bm` → bookmarklet iframe mode (overlaid on host page)

### URL params

| Param       | Meaning                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `instances` | Unicode-safe base64 JSON array `{vault, folder?, name?, emoji?, canvas?, props?}[]` |
| `mode`      | `configure` or `bm`                                                                 |
| `su`        | Scraper service URL (falls back to `VITE_SCRAPER_URL`)                              |
| `ss`        | Scraper bearer secret                                                               |

### Bookmarklet

Injects a fullscreen iframe overlay. Passes page content (HTML or YouTube data) to the app via the URL fragment. The app extracts content client-side and opens an `obsidian://` URI on save.

## Tests

Colocate tests with the code they test. Exception: e2e tests live in `apps/app/e2e/`.

Always ensure all tests pass before committing.

## Commits

Write commit messages, PR titles, and PR descriptions as a humble but experienced engineer. Casual but terse. Avoid listing implementation details. Highlight non-obvious choices.
