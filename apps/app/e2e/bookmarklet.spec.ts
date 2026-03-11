/**
 * E2E tests for the bookmarklet capture flow.
 *
 * Uses the real generated bookmarklet code (not an inline copy) so any
 * regression in bookmarklet.ts breaks these tests immediately.
 *
 * Flow per test:
 * 1. Intercept the fixture URL (browser navigation) with minimal HTML so
 *    page scripts don't run/redirect — location.href stays as fixture.url
 * 2. Intercept the scraper endpoint so the app receives the fixture HTML
 *    with url set to the canonical fixture.url (e.g. https://www.youtube.com/watch?v=...)
 * 3. Navigate the browser to fixture.url (becomes location.href the bookmarklet reads)
 * 4. Run the generated bookmarklet via page.evaluate()
 * 5. Wait for the iframe (mode=bm); verify url= param is correctly passed
 * 6. Wait for .scrape-entry--done (scraper fetches and parses the fixture)
 * 7. Click Save; capture obsidian URI from window.__obsidianUrl; assert content
 */

import { test, expect } from '@playwright/test';
import { generateBookmarklet } from '../src/lib/bookmarklet.js';
import { VAULT, FOLDER, CAPTURE_BASE, FIXTURES } from './helpers.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Bookmarklet capture flow', () => {
  for (const fixture of FIXTURES) {
    test(`bookmarklet: ${fixture.name}`, async ({ page }) => {
      // Serve minimal HTML to the browser for the fixture URL so page scripts
      // don't run or redirect — preserves location.href for the bookmarklet.
      await page.route(fixture.url, route =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!DOCTYPE html><html><head><title>${fixture.name}</title></head><body></body></html>`,
        }),
      );

      // Mock the scraper endpoint: return fixture HTML with the canonical URL
      // so isYouTubeVideo() fires correctly in doScrapeEntry.
      await page.route('http://localhost:8080/fetch**', async route => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ url: fixture.url, html: fixture.html }),
        });
      });

      await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });

      // Set up obsidianUri listener before bookmarklet runs
      await page.evaluate(() => {
        window.addEventListener('message', (e: MessageEvent) => {
          if (e.data?.type === 'obsidianUri') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__obsidianUrl = e.data.url;
          }
        });
      });

      // Register the frame listener BEFORE evaluating the bookmarklet to avoid
      // missing the framenavigated event if the iframe loads quickly.
      const frameNavPromise = page.waitForEvent('framenavigated', {
        predicate: frame => frame.url().includes('mode=bm'),
        timeout: 10000,
      });

      // Run the real generated bookmarklet — proves the actual deployed code works
      const bookmarkletUrl = generateBookmarklet(CAPTURE_BASE as string);
      const code = decodeURIComponent(bookmarkletUrl.slice('javascript:'.length));
      await page.evaluate(code);

      const captureFrame = await frameNavPromise;

      // Verify the fixture URL is correctly passed in the iframe src
      const frameUrlParsed = new URL(captureFrame.url());
      expect(frameUrlParsed.searchParams.get('url')).toBe(fixture.url);

      // Use frameLocator for reliable element access within the iframe
      const frameLocator = page.frameLocator('iframe[src*="mode=bm"]');

      // Wait for scraper to finish fetching and parsing
      await frameLocator.locator('.scrape-entry--done').waitFor({ timeout: 15000 });

      // Click Save
      await frameLocator.locator('#btnSave').click();

      // Capture the obsidian URI posted to the parent frame
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.waitForFunction(() => !!(window as any).__obsidianUrl, { timeout: 5000 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obsidianUrl = await page.evaluate(() => (window as any).__obsidianUrl as string);

      // Parse the obsidian://new?vault=...&file=...&content=... URI
      const qs = obsidianUrl.slice(obsidianUrl.indexOf('?') + 1);
      const obsParams = new URLSearchParams(qs);
      expect(obsParams.get('vault')).toBe(VAULT);
      expect(obsParams.get('file')).toContain(`${FOLDER}/`);
      expect(obsParams.get('file')).toMatch(/\.md$/);

      // Verify the fixture URL ended up in the note's what field — proves the bookmarklet
      // correctly captured location.href and the app used it as the scrape target.
      const content = obsParams.get('content') ?? '';
      expect(content).toContain(`what: "${fixture.url}"`);
      // Verify some content was extracted (scraper + extraction ran successfully).
      // Detailed content assertions live in scraper.spec.js where the real URLs are used.
      expect(content.length).toBeGreaterThan(200);
    });
  }
});
