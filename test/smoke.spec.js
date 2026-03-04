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
