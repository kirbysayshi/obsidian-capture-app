/**
 * E2E tests for the scraper auto-fetch integration.
 *
 * The scraper endpoint (http://localhost:8080/fetch) is intercepted via
 * page.route() so tests run offline and fixture URLs match the canonical
 * form (e.g. https://www.youtube.com/watch?v=...) that isYouTubeVideo()
 * recognises, exercising the correct extraction path end-to-end.
 */

import { test, expect, type Page } from '@playwright/test';
import { VAULT, FOLDER, CAPTURE_BASE, FIXTURES } from './helpers.js';

// ── Scraper mock ──────────────────────────────────────────────────────────────

/**
 * Intercept all scraper fetches for the page.
 * Returns fixture HTML for known fixture URLs; 404 JSON for everything else.
 */
function mockScraper(page: Page): Promise<void> {
  return page.route('http://localhost:8080/fetch**', async (route) => {
    const reqUrl = new URL(route.request().url());
    const targetUrl = decodeURIComponent(reqUrl.searchParams.get('url') ?? '');
    const fixture = FIXTURES.find((f) => f.url === targetUrl);
    if (fixture) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ url: fixture.url, html: fixture.html }),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not found' }),
      });
    }
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Scraper auto-fetch flow', () => {
  for (const fixture of FIXTURES) {
    test(`scraper: ${fixture.name}`, async ({ page }) => {
      await mockScraper(page);
      await page.goto(CAPTURE_BASE);

      // Listen for obsidianUri postMessage before triggering scrape
      const uriPromise = page.evaluate(
        () =>
          new Promise<string>((resolve) =>
            window.addEventListener('message', (e: MessageEvent) => {
              if ((e.data as { type?: string })?.type === 'obsidianUri')
                resolve((e.data as { url: string }).url);
            }),
          ),
      );

      // Paste canonical fixture URL into What field — triggers auto-scrape after 600ms
      await page.fill('#fieldWhat', fixture.url);

      // Wait for content extraction to complete (entry transitions to done)
      await expect(page.locator('.scrape-entry--done')).toBeVisible({
        timeout: 15_000,
      });

      // Click Save
      await page.locator('#btnSave').click();
      const uri = await uriPromise;

      // Assert vault, folder, and file extension
      const qs = uri.slice(uri.indexOf('?') + 1);
      const params = new URLSearchParams(qs);
      expect(params.get('vault')).toBe(VAULT);
      expect(params.get('file')).toContain(`${FOLDER}/`);
      expect(params.get('file')).toMatch(/\.md$/);
    });
  }
});

test.describe('Multi-URL scrape list', () => {
  test('two URLs → two entries, no auto-scrape', async ({ page }) => {
    await mockScraper(page);
    await page.goto(CAPTURE_BASE);

    const url1 = FIXTURES[0].url;
    const url2 = FIXTURES[1].url;
    await page.fill('#fieldWhat', `${url1}\n${url2}`);

    // Two entries appear immediately
    await expect(page.locator('.scrape-entry')).toHaveCount(2);
    // Neither is done (no auto-scrape for multiple URLs)
    await expect(page.locator('.scrape-entry--done')).toHaveCount(0);
  });

  test('clicking pending entry header triggers scrape', async ({ page }) => {
    await mockScraper(page);
    await page.goto(CAPTURE_BASE);

    const url1 = FIXTURES[0].url;
    const url2 = FIXTURES[1].url;
    await page.fill('#fieldWhat', `${url1}\n${url2}`);

    // Click the first pending entry header
    await page
      .locator('.scrape-entry--pending .scrape-entry-header--clickable')
      .first()
      .click();

    // First entry transitions to done
    await expect(page.locator('.scrape-entry--done')).toHaveCount(1, {
      timeout: 15_000,
    });
    // Second entry remains pending
    await expect(page.locator('.scrape-entry--pending')).toHaveCount(1);
  });

  test('exclude button grays out entry', async ({ page }) => {
    await mockScraper(page);
    await page.goto(CAPTURE_BASE);

    await page.fill('#fieldWhat', FIXTURES[0].url);

    // Wait for auto-scrape to finish
    await expect(page.locator('.scrape-entry--done')).toBeVisible({
      timeout: 15_000,
    });

    // Click exclude
    await page.locator('.btn-exclude-entry').click();
    await expect(page.locator('.scrape-entry--excluded')).toBeVisible();

    // Undo button appears (↩)
    await expect(
      page.locator('.btn-exclude-entry[data-action="include"]'),
    ).toBeVisible();
  });

  test('error state shows retry button', async ({ page }) => {
    await mockScraper(page);
    await page.goto(CAPTURE_BASE);

    // Unknown URL → mock returns 404 → scraper error
    await page.fill('#fieldWhat', 'https://example.com/not-found');

    // Auto-scrape fires, gets 404, transitions to error
    await expect(page.locator('.scrape-entry--error')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.btn-retry-entry')).toBeVisible();
  });
});
