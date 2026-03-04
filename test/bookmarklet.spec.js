/**
 * End-to-end bookmarklet capture flow tests.
 *
 * For each fixture in test/fixtures/:
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
import { readFileSync } from 'fs';

// ── Fixture definitions ───────────────────────────────────────────────────────

const VAULT = 'TestVault';
const FOLDER = 'Inbox';
const CAPTURE_BASE = `http://localhost:5174/?v=${VAULT}&f=${FOLDER}`;

const FIXTURES = [
  {
    name: 'YouTube desktop',
    file: 'youtube-rosalia.html',
    // Serve at the desktop YouTube URL so isYouTubeVideo() matches
    url: 'https://www.youtube.com/watch?v=7fyufPkXLbs',
    expectFileContains: 'Berghain',
    expectContentContains: [
      'what: "https://www.youtube.com/watch?v=7fyufPkXLbs"',
      '# ROSALÍA - Berghain (Live at The BRIT Awards 2026) ft. Björk',
      '**Channel:** ROSALÍA · 12.1M subscribers',
      // Use a quote-free line — YouTube description uses curly quotes (U+201C/D)
      'feat. Björk Live at The BRIT Awards 2026',
      'Directed and Produced by BRIT Awards Ltd',
    ],
  },
  {
    name: 'YouTube mobile',
    file: 'youtube-rosalia-mobile.html',
    // Serve at the mobile YouTube URL so isYouTubeVideo() matches
    url: 'https://m.youtube.com/watch?v=7fyufPkXLbs',
    expectFileContains: 'Berghain',
    expectContentContains: [
      // YouTube's JS appends tracking params (&pp=...) to location.href on mobile
      'what: "https://m.youtube.com/watch?v=7fyufPkXLbs',
      '# ROSALÍA - Berghain (Live at The BRIT Awards 2026) ft. Björk',
      '**Channel:** ROSALÍA · 12.1M',
      'feat. Björk Live at The BRIT Awards 2026',
      'Directed and Produced by BRIT Awards Ltd',
    ],
  },
];

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
  iframe.src = configuredUrl + '&mode=bm';
  iframe.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(500px,95vw);height:min(640px,90vh);border:none;border-radius:12px';
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  window.addEventListener('message', function handler(e) {
    if (e.source !== iframe.contentWindow) return;
    if (e.data && e.data.type === 'requestContent') {
      iframe.contentWindow.postMessage({
        type: 'pageContent',
        html: document.documentElement.outerHTML,
        url: location.href,
        title: document.title,
      }, '*');
    }
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

  for (const { name, file, url, expectFileContains, expectContentContains } of FIXTURES) {
    test(name, async ({ page }) => {
      // Serve the fixture at its expected URL
      await page.route(url, route =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: readFileSync(`test/fixtures/${file}`, 'utf-8'),
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
      expect(filePath).toContain(expectFileContains);
      for (const str of expectContentContains) {
        expect(content).toContain(str);
      }
    });
  }
});
