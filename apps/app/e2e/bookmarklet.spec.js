/**
 * End-to-end bookmarklet capture flow tests.
 *
 * Fixtures live in e2e/fixtures/*.md. Each file has two sections:
 *   1. YAML frontmatter (name, url, expectContains[])
 *   2. HTML content (served at the fixture's url via page.route)
 *
 * For each fixture:
 *   1. Serve the fixture HTML at its configured URL via page.route
 *   2. Inject and run the bookmarklet (creates the overlay iframe)
 *   3. Wait for the iframe's capture form to finish extracting content
 *   4. Click "Save to Obsidian"
 *   5. Assert the resulting obsidian:// URI has the expected vault, file, and content
 *
 * Before navigating, use.ts posts { type: 'obsidianUri', url } to window.parent.
 * The test captures this message on the parent frame via page.evaluate +
 * window.addEventListener, avoiding any navigation interception complexity.
 */

import { test, expect } from '@playwright/test';
import { VAULT, FOLDER, CAPTURE_BASE, FIXTURES } from './helpers.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mirrors the bookmarklet function from src/lib/bookmarklet.ts.
 * Called via page.evaluate — creates the overlay iframe on the fixture page.
 */
function runBookmarklet(configuredUrl) {
  const ID = '__obsidian_capture__';
  const overlay = document.createElement('div');
  overlay.id = ID;
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;background:rgba(0,0,0,.6)';
  const iframe = document.createElement('iframe');
  const html = document.documentElement.outerHTML;
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  let ytSubset = null;
  try {
    const ytGlobal = window.ytInitialData;
    if (ytGlobal) {
      const ytData = typeof ytGlobal === 'string' ? JSON.parse(ytGlobal) : ytGlobal;
      const subset = {};
      const c = ytData.contents;
      if (c && c.twoColumnWatchNextResults) {
        const items = c.twoColumnWatchNextResults?.results?.results?.contents ?? [];
        subset.contents = {
          twoColumnWatchNextResults: {
            results: { results: { contents: items.filter(item =>
              item.videoPrimaryInfoRenderer || item.videoSecondaryInfoRenderer
            ) } },
          },
        };
      } else if (c && c.singleColumnWatchNextResults) {
        const mItems = c.singleColumnWatchNextResults?.results?.results?.contents ?? [];
        subset.contents = {
          singleColumnWatchNextResults: {
            results: { results: { contents: mItems.filter(item =>
              item.slimVideoMetadataSectionRenderer
            ) } },
          },
        };
        if (ytData.engagementPanels) {
          subset.engagementPanels = ytData.engagementPanels.filter(p => {
            const epslr = p.engagementPanelSectionListRenderer;
            return epslr && epslr.panelIdentifier === 'video-description-ep-identifier';
          });
        }
      }
      if (subset.contents) { ytSubset = subset; }
    }
  } catch (_e) { /* silent */ }

  const payload = { html: stripped };
  if (ytSubset) payload.yt = ytSubset;
  const b64 = btoa(
    Array.from(new TextEncoder().encode(JSON.stringify(payload)))
      .map(b => String.fromCharCode(b))
      .join('')
  );
  iframe.src = configuredUrl
    + '&mode=bm'
    + '&url=' + encodeURIComponent(location.href)
    + '&title=' + encodeURIComponent(document.title)
    + '#' + b64;
  iframe.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(500px,95vw);height:min(640px,90vh);border:none;border-radius:12px';
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  window.addEventListener('message', function handler(e) {
    if (e.source !== iframe.contentWindow) return;
    if (e.data && e.data.type === 'close') {
      overlay.remove();
      window.removeEventListener('message', handler);
    }
    // obsidianUri messages bubble up from the iframe — store for the test to read
    if (e.data && e.data.type === 'obsidianUri') {
      window.__obsidianUrl = e.data.url;
    }
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Bookmarklet capture flow', () => {
  // YouTube fixture pages have CSP headers — bypass so our localhost iframe loads
  test.use({ bypassCSP: true });

  for (const { name, url, expectContains, html } of FIXTURES) {
    test(name, async ({ page }) => {
      // Serve the fixture at its expected URL
      await page.route(url, route =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: html,
        }),
      );

      // Navigate to the fixture page (simulates the user already being there)
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Inject the bookmarklet — creates the overlay + capture iframe
      await page.evaluate(runBookmarklet, CAPTURE_BASE);

      // Wait for the capture iframe to navigate to its URL and grab the Frame handle
      const captureFrame = await page.waitForEvent('framenavigated', {
        predicate: frame => frame.url().includes('mode=bm'),
        timeout: 10000,
      });

      // Wait for content extraction to finish (loading indicator is removed)
      await captureFrame.waitForFunction(
        () => !document.getElementById('loadingIndicator'),
        { timeout: 15000 },
      );

      // Click Save to Obsidian
      await captureFrame.locator('#btnSave').click();

      // use.ts posts { type: 'obsidianUri', url } to window.parent before navigating.
      // runBookmarklet stores it in window.__obsidianUrl on the parent frame.
      await page.waitForFunction(() => window.__obsidianUrl, { timeout: 5000 });
      const obsidianUrl = await page.evaluate(() => window.__obsidianUrl);

      // Parse the obsidian://new?vault=...&file=...&content=... URI
      const qs = obsidianUrl.slice(obsidianUrl.indexOf('?') + 1);
      const params = new URLSearchParams(qs);
      const vault    = params.get('vault');
      const filePath = params.get('file');
      const content  = params.get('content');

      expect(vault).toBe(VAULT);
      expect(filePath).toContain(`${FOLDER}/`);
      expect(filePath).toMatch(/\.md$/);
      for (const str of expectContains) {
        expect(content).toContain(str);
      }
    });
  }
});
