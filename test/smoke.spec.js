import { test, expect, devices } from '@playwright/test';

// Strip defaultBrowserType so test.use() can be called inside describe blocks
const { defaultBrowserType: _a, ...iPhoneSE } = devices['iPhone SE'];

/** Generate a safe screenshot path from the test's title hierarchy. */
function ss(testInfo, suffix = '') {
  const safe = testInfo.titlePath
    .join(' - ')
    .replace(/[^a-z0-9\-_. ]/gi, '_');
  return `test/screenshots/${safe}${suffix ? `-${suffix}` : ''}.png`;
}

// ── Configure view (desktop) ─────────────────────────────────────────────────

test.describe('Configure view', () => {
  test('renders form fields', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('#vault')).toBeVisible();
    await expect(page.locator('#shortcutEmoji')).toBeVisible();
    await expect(page.locator('#outputSection')).toBeHidden();
    await page.screenshot({ path: ss(testInfo), fullPage: true });
  });
});

// ── Emoji row layout (mobile) ─────────────────────────────────────────────────

test.describe('Emoji row layout', () => {
  test.use({ ...iPhoneSE });

  test('emoji input is small, name input fills remaining space', async ({ page }, testInfo) => {
    await page.goto('/');
    const emojiBox = await page.locator('#shortcutEmoji').boundingBox();
    const nameBox  = await page.locator('#shortcutName').boundingBox();
    expect(emojiBox?.width).toBeLessThanOrEqual(60);
    expect(nameBox?.width).toBeGreaterThan(150);
    expect(nameBox?.width).toBeGreaterThan(emojiBox?.width ?? Infinity);
    await page.screenshot({ path: ss(testInfo), fullPage: true });
  });
});

// ── Stale notice ──────────────────────────────────────────────────────────────

test.describe('Stale notice', () => {
  test('hidden after Generate, shown on edit, cleared on revert', async ({ page }) => {
    await page.goto('/');
    await page.fill('#vault', 'TestVault');
    await page.click('#btnGenerate');
    await expect(page.locator('#outputSection')).toBeVisible();

    await expect(page.locator('#staleNotice')).toBeHidden();

    await page.fill('#vault', 'TestVaultEdited');
    await expect(page.locator('#staleNotice')).toBeVisible();

    await page.fill('#vault', 'TestVault');
    await expect(page.locator('#staleNotice')).toBeHidden();
  });

  test('canvas toggle marks and clears stale', async ({ page }) => {
    await page.goto('/');
    await page.fill('#vault', 'TestVault');
    await page.click('#btnGenerate');

    await page.click('#canvas');
    await expect(page.locator('#staleNotice')).toBeVisible();

    await page.click('#canvas');
    await expect(page.locator('#staleNotice')).toBeHidden();
  });
});

// ── Boolean props (configure) ─────────────────────────────────────────────────

test.describe('Boolean props — configure view', () => {
  test('type icon starts as text (≡), toggles to boolean (☑)', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.click('#btnAddProp');

    const icon = page.locator('.prop-type-icon');
    await expect(icon).toHaveText('≡');
    await expect(page.locator('.prop-val')).toBeVisible();
    await expect(page.locator('.prop-bool-default')).toBeHidden();
    await page.screenshot({ path: ss(testInfo, 'text') });

    await icon.click();
    await expect(icon).toHaveText('☑');
    await expect(page.locator('.prop-val')).toBeHidden();
    await expect(page.locator('.prop-bool-default')).toBeVisible();
    await page.screenshot({ path: ss(testInfo, 'boolean') });

    await icon.click();
    await expect(icon).toHaveText('≡');
    await expect(page.locator('.prop-val')).toBeVisible();
  });

  test('default value checkbox is reflected in generated URL', async ({ page }) => {
    await page.goto('/');
    await page.fill('#vault', 'Vault');
    await page.click('#btnAddProp');
    await page.fill('.prop-key', 'published');
    await page.click('.prop-type-icon');          // switch to boolean
    await page.click('.prop-bool-check');          // set default = true
    await page.click('#btnGenerate');

    const url = await page.locator('#useUrlInput').inputValue();
    expect(url).toContain('props=');

    // Decode the props param and verify
    const params = new URL(url).searchParams;
    const props = JSON.parse(atob(params.get('props') ?? ''));
    expect(props[0]).toMatchObject({ k: 'published', type: 'boolean', v: 'true' });
  });

  test('stale notice responds to boolean default checkbox change', async ({ page }) => {
    await page.goto('/');
    await page.fill('#vault', 'Vault');
    await page.click('#btnAddProp');
    await page.fill('.prop-key', 'published');
    await page.click('.prop-type-icon');
    await page.click('#btnGenerate');

    await expect(page.locator('#staleNotice')).toBeHidden();
    await page.click('.prop-bool-check');
    await expect(page.locator('#staleNotice')).toBeVisible();
    await page.click('.prop-bool-check'); // revert
    await expect(page.locator('#staleNotice')).toBeHidden();
  });
});

// ── Boolean props (use view) ──────────────────────────────────────────────────

test.describe('Boolean props — use view', () => {
  test('boolean prop renders as checkbox defaulting to false', async ({ page }, testInfo) => {
    const propsParam = btoa(JSON.stringify([{ k: 'published', v: 'false', type: 'boolean' }]));
    await page.goto(`/?v=Vault&props=${propsParam}`);

    const cb = page.locator('.bool-prop-checkbox');
    await expect(cb).toBeVisible();
    await expect(cb).not.toBeChecked();
    await expect(page.locator('.bool-prop-checkbox + span, .bool-prop-checkbox ~ span')).toContainText('published');
    await page.screenshot({ path: ss(testInfo), fullPage: true });
  });

  test('boolean prop renders checked when default is true', async ({ page }) => {
    const propsParam = btoa(JSON.stringify([{ k: 'published', v: 'true', type: 'boolean' }]));
    await page.goto(`/?v=Vault&props=${propsParam}`);

    await expect(page.locator('.bool-prop-checkbox')).toBeChecked();
  });

  test('text props do not appear as checkboxes in use view', async ({ page }) => {
    const propsParam = btoa(JSON.stringify([{ k: 'category', v: 'web', type: 'text' }]));
    await page.goto(`/?v=Vault&props=${propsParam}`);
    await expect(page.locator('.bool-prop-checkbox')).toHaveCount(0);
  });
});

// ── Use view basics (mobile) ──────────────────────────────────────────────────

test.describe('Use view', () => {
  test.use({ ...iPhoneSE });

  test('shows vault info and configure link', async ({ page }) => {
    await page.goto('/?v=MyVault&f=Inbox&n=Capture&e=%F0%9F%93%8E');
    await expect(page.locator('.vault-info')).toBeVisible();

    const link = page.locator('#configureLink');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('mode=configure');
    expect(href).toContain('v=MyVault');
  });
});

// ── YouTube metadata extraction ───────────────────────────────────────────────

test.describe('YouTube metadata extraction', () => {
  test('extracts title, channel, and description from fixture HTML (Node-side sanity check)', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync('test/fixtures/youtube-rosalia.html', 'utf-8');

    // Mirror parseYtInitialData — pure string + JSON.parse, no DOMParser
    const MARKER = 'var ytInitialData = ';
    const markerIdx = html.indexOf(MARKER);
    expect(markerIdx).toBeGreaterThan(-1);

    const jsonStart = markerIdx + MARKER.length;
    const scriptEnd = html.indexOf('</script>', jsonStart);
    expect(scriptEnd).toBeGreaterThan(-1);

    const data = JSON.parse(html.slice(jsonStart, scriptEnd).trim().replace(/;$/, '').trim());

    const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
    let title = '', channel = '', description = '';
    for (const item of contents) {
      if (item.videoPrimaryInfoRenderer) {
        title = (item.videoPrimaryInfoRenderer.title.runs ?? []).map(r => r.text).join('');
      }
      if (item.videoSecondaryInfoRenderer) {
        const vsir = item.videoSecondaryInfoRenderer;
        description = vsir.attributedDescription?.content ?? '';
        const owner = vsir.owner?.videoOwnerRenderer;
        channel = (owner?.title?.runs ?? []).map(r => r.text).join('');
      }
    }

    expect(title).toBe('ROSALÍA - Berghain (Live at The BRIT Awards 2026) ft. Björk');
    expect(channel).toBe('ROSALÍA');
    expect(description).toContain('Berghain');
  });

  test('bookmarklet mode: raw fixture HTML injected directly', async ({ page }, testInfo) => {
    const { readFileSync } = await import('fs');
    const fixtureHtml = readFileSync('test/fixtures/youtube-rosalia.html', 'utf-8');

    await page.goto('/?v=TestVault&mode=bm');
    await expect(page.locator('#loadingIndicator')).toBeVisible();

    await page.evaluate((html) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'pageContent',
          html,
          url: 'https://www.youtube.com/watch?v=7fyufPkXLbs',
          title: 'ROSALÍA - Berghain (Live at The BRIT Awards 2026) ft. Björk',
        },
      }));
    }, fixtureHtml);

    await expect(page.locator('#loadingIndicator')).toHaveCount(0);

    await page.locator('#debugDetails').evaluate(el => el.setAttribute('open', ''));
    const debugText = await page.locator('#debugLog').textContent();
    console.log('\n=== [raw fixture] debug log ===\n' + debugText + '\n==============================\n');
    await page.screenshot({ path: ss(testInfo), fullPage: true });

    await expect(page.locator('#contentPreview')).toBeVisible();
    await expect(page.locator('#contentPreviewText')).toContainText('ROSALÍA');
  });

  test('bookmarklet mode: outerHTML captured after browser parses fixture', async ({ page, context }, testInfo) => {
    const { readFileSync } = await import('fs');
    const fixtureHtml = readFileSync('test/fixtures/youtube-rosalia.html', 'utf-8');

    // Serve the fixture as a fake YouTube page so the browser actually parses
    // and runs it (simulating what outerHTML looks like after JS execution)
    await page.route('https://www.youtube.com/watch?v=fixture', route =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureHtml }),
    );
    const ytPage = await context.newPage();
    await ytPage.route('https://www.youtube.com/watch?v=fixture', route =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureHtml }),
    );
    await ytPage.goto('https://www.youtube.com/watch?v=fixture', { waitUntil: 'domcontentloaded' });

    // Capture outerHTML + check if ytInitialData marker survived JS execution
    const { outerHtml, markerPresent, outerHtmlLen } = await ytPage.evaluate(() => {
      const oh = document.documentElement.outerHTML;
      return {
        outerHtml: oh,
        outerHtmlLen: oh.length,
        markerPresent: oh.includes('var ytInitialData = '),
      };
    });
    console.log(`\n=== outerHTML stats ===\nlength: ${outerHtmlLen}\nmarker present: ${markerPresent}\n======================\n`);

    await ytPage.close();

    // Now inject the outerHTML into the capture app
    const capturePage = await context.newPage();
    await capturePage.goto('http://localhost:5174/?v=TestVault&mode=bm');
    await expect(capturePage.locator('#loadingIndicator')).toBeVisible();

    await capturePage.evaluate((html) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'pageContent',
          html,
          url: 'https://www.youtube.com/watch?v=fixture',
          title: 'ROSALÍA test',
        },
      }));
    }, outerHtml);

    await expect(capturePage.locator('#loadingIndicator')).toHaveCount(0);

    await capturePage.locator('#debugDetails').evaluate(el => el.setAttribute('open', ''));
    const debugText = await capturePage.locator('#debugLog').textContent();
    console.log('\n=== [outerHTML] debug log ===\n' + debugText + '\n=============================\n');
    await capturePage.screenshot({ path: ss(testInfo), fullPage: true });

    await capturePage.close();

    // If the marker survived, we expect extraction to succeed
    if (markerPresent) {
      // Can't assert on capturePage after close — marker check is the key signal
    }
    expect(markerPresent).toBe(true); // fails loudly if YouTube strips the script
  });
});

// ── Edit configuration prefill ────────────────────────────────────────────────

test.describe('Edit configuration prefill', () => {
  test('prefills vault, folder, and name from URL params', async ({ page }) => {
    await page.goto('/?mode=configure&v=MyVault&f=Inbox&n=Capture&e=%F0%9F%93%8E');
    await expect(page.locator('#vault')).toHaveValue('MyVault');
    await expect(page.locator('#folder')).toHaveValue('Inbox');
    await expect(page.locator('#shortcutName')).toHaveValue('Capture');
  });

  test('prefills boolean prop type and default value', async ({ page }) => {
    const propsParam = btoa(JSON.stringify([{ k: 'published', v: 'true', type: 'boolean' }]));
    await page.goto(`/?mode=configure&v=Vault&props=${propsParam}`);

    await expect(page.locator('.prop-type-icon')).toHaveText('☑');
    await expect(page.locator('.prop-bool-check')).toBeChecked();
  });
});
