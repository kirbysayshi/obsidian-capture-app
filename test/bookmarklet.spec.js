/**
 * End-to-end bookmarklet capture flow tests.
 *
 * Fixtures live in test/fixtures/*.md. Each file has two sections:
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
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Fixture loading ────────────────────────────────────────────────────────────

const VAULT = 'TestVault';
const FOLDER = 'Inbox';
const CAPTURE_BASE = `http://localhost:5174/?v=${VAULT}&f=${FOLDER}`;
const FIXTURES_DIR = 'test/fixtures';

/** Parse a minimal YAML subset: scalar strings and one string-list field. */
function parseFrontmatter(text) {
  const fm = {};
  let currentListKey = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const listItem = line.match(/^  - (.*)$/);
    if (listItem && currentListKey) {
      const val = listItem[1];
      // Strip surrounding single quotes used as YAML string delimiters
      fm[currentListKey].push(
        val.startsWith("'") && val.endsWith("'") ? val.slice(1, -1) : val,
      );
      continue;
    }
    currentListKey = null;
    const scalar = line.match(/^(\w+):\s*(.*)$/);
    if (scalar) {
      const [, key, val] = scalar;
      if (val === '') {
        fm[key] = [];
        currentListKey = key;
      } else {
        fm[key] = val;
      }
    }
  }
  return fm;
}

/** Parse a fixture .md file into { name, url, expectContains, html }. */
function parseFixture(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Invalid fixture format: ${filePath}`);
  const [, fmText, html] = match;
  const fm = parseFrontmatter(fmText);
  return { name: fm.name, url: fm.url, expectContains: fm.expectContains ?? [], html };
}

const FIXTURES = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => parseFixture(join(FIXTURES_DIR, f)));

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
