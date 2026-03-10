/**
 * E2E tests for the scraper auto-fetch integration.
 *
 * A Node.js fixture HTTP server serves fixture HTML so the real scraper service
 * (started by playwright.config.js on port 8080) can fetch it. The app uses
 * VITE_SCRAPER_URL=http://localhost:8080 from .env.development — no su= param needed.
 */

import { test, expect } from '@playwright/test';
import http from 'http';
import { VAULT, FOLDER, CAPTURE_BASE, FIXTURES } from './helpers.js';

// ── Fixture server ────────────────────────────────────────────────────────────

let fixtureServer;
let fixturePort;
const fixtureMap = new Map();

test.beforeAll(async () => {
  for (const f of FIXTURES) {
    const slug = f.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    fixtureMap.set('/' + slug, f);
  }

  fixtureServer = http.createServer((req, res) => {
    const f = fixtureMap.get((req.url ?? '/').split('?')[0]);
    if (f) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(f.html);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  fixturePort = fixtureServer.address().port;
});

test.afterAll(async () => {
  await new Promise(resolve => fixtureServer.close(resolve));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Scraper auto-fetch flow', () => {
  for (const fixture of FIXTURES) {
    const slug = fixture.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    test(`scraper: ${fixture.name}`, async ({ page }) => {
      // Navigate directly to the use view.
      // In dev, VITE_SCRAPER_URL=http://localhost:8080 so hasScraperConfig is true without su= param.
      await page.goto(CAPTURE_BASE);

      // Listen for obsidianUri postMessage before triggering scrape
      const uriPromise = page.evaluate(() =>
        new Promise(resolve => window.addEventListener('message', e => {
          if (e.data?.type === 'obsidianUri') resolve(e.data.url);
        }))
      );

      // Paste local fixture server URL into What field — triggers auto-scrape after 600ms
      const targetUrl = `http://127.0.0.1:${fixturePort}/${slug}`;
      await page.fill('#fieldWhat', targetUrl);

      // Wait for content extraction to complete (entry transitions to done)
      await expect(page.locator('.scrape-entry--done')).toBeVisible({ timeout: 15_000 });

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
    await page.goto(CAPTURE_BASE);

    const slug = FIXTURES[0].name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const url1 = `http://127.0.0.1:${fixturePort}/${slug}`;
    const url2 = `http://127.0.0.1:${fixturePort}/second`;
    await page.fill('#fieldWhat', `${url1}\n${url2}`);

    // Two entries appear immediately
    await expect(page.locator('.scrape-entry')).toHaveCount(2);
    // Neither is done (no auto-scrape for multiple URLs)
    await expect(page.locator('.scrape-entry--done')).toHaveCount(0);
  });

  test('clicking pending entry header triggers scrape', async ({ page }) => {
    await page.goto(CAPTURE_BASE);

    const slug = FIXTURES[0].name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const url1 = `http://127.0.0.1:${fixturePort}/${slug}`;
    const url2 = `http://127.0.0.1:${fixturePort}/second`;
    await page.fill('#fieldWhat', `${url1}\n${url2}`);

    // Click the first pending entry header
    await page.locator('.scrape-entry--pending .scrape-entry-header--clickable').first().click();

    // First entry transitions to done
    await expect(page.locator('.scrape-entry--done')).toHaveCount(1, { timeout: 15_000 });
    // Second entry remains pending
    await expect(page.locator('.scrape-entry--pending')).toHaveCount(1);
  });

  test('exclude button grays out entry', async ({ page }) => {
    await page.goto(CAPTURE_BASE);

    const slug = FIXTURES[0].name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const targetUrl = `http://127.0.0.1:${fixturePort}/${slug}`;
    await page.fill('#fieldWhat', targetUrl);

    // Wait for auto-scrape to finish
    await expect(page.locator('.scrape-entry--done')).toBeVisible({ timeout: 15_000 });

    // Click exclude
    await page.locator('.btn-exclude-entry').click();
    await expect(page.locator('.scrape-entry--excluded')).toBeVisible();

    // Undo button appears (↩)
    await expect(page.locator('.btn-exclude-entry[data-action="include"]')).toBeVisible();
  });

  test('error state shows retry button', async ({ page }) => {
    await page.goto(CAPTURE_BASE);

    // URL that returns 404 from fixture server → scraper error
    const badUrl = `http://127.0.0.1:${fixturePort}/does-not-exist`;
    await page.fill('#fieldWhat', badUrl);

    // Auto-scrape fires, gets 404, transitions to error
    await expect(page.locator('.scrape-entry--error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.btn-retry-entry')).toBeVisible();
  });
});
