import { test, expect, devices, type TestInfo } from '@playwright/test';

// Strip defaultBrowserType so test.use() can be called inside describe blocks
const { defaultBrowserType: _a, ...iPhoneSE } = devices['iPhone SE'];

/** Generate a safe screenshot path from the test's title hierarchy. */
function ss(testInfo: TestInfo, suffix = ''): string {
  const safe = testInfo.titlePath
    .join(' - ')
    .replace(/[^a-z0-9\-_. ]/gi, '_');
  return `e2e/screenshots/${safe}${suffix ? `-${suffix}` : ''}.png`;
}

/** Unicode-safe base64 encode (handles emoji and non-Latin-1). */
function toBase64(str: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(str))
      .map(b => String.fromCharCode(b))
      .join(''),
  );
}

interface PropConfig {
  k: string;
  v: string;
  type?: string;
}

interface InstanceConfig {
  vault: string;
  folder?: string;
  name?: string;
  emoji?: string;
  canvas?: boolean;
  props?: PropConfig[];
}

/** Build a ?instances= URL for one or more configs. */
function instancesUrl(configs: InstanceConfig[]): string {
  const data = configs.map(cfg => ({
    vault: cfg.vault,
    ...(cfg.folder && { folder: cfg.folder }),
    ...(cfg.name && { name: cfg.name }),
    ...(cfg.emoji && { emoji: cfg.emoji }),
    ...(cfg.canvas && { canvas: true }),
    ...(cfg.props?.length && { props: cfg.props }),
  }));
  return `/?instances=${encodeURIComponent(toBase64(JSON.stringify(data)))}`;
}

// ── Configure view (desktop) ─────────────────────────────────────────────────

test.describe('Configure view', () => {
  test('renders form fields', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('.vault-input')).toBeVisible();
    await expect(page.locator('.shortcut-emoji-input')).toBeVisible();
    await expect(page.locator('#outputSection')).toBeHidden();
    await page.screenshot({ path: ss(testInfo), fullPage: true });
  });
});

// ── Emoji row layout (mobile) ─────────────────────────────────────────────────

test.describe('Emoji row layout', () => {
  test.use({ ...iPhoneSE });

  test('emoji input is small, name input fills remaining space', async ({ page }, testInfo) => {
    await page.goto('/');
    const emojiBox = await page.locator('.shortcut-emoji-input').boundingBox();
    const nameBox  = await page.locator('.shortcut-name-input').boundingBox();
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
    await page.fill('.vault-input', 'TestVault');
    await page.fill('.folder-input', 'Inbox');
    await page.click('#btnGenerate');
    await expect(page.locator('#outputSection')).toBeVisible();

    await expect(page.locator('#staleNotice')).toBeHidden();

    await page.fill('.vault-input', 'TestVaultEdited');
    await expect(page.locator('#staleNotice')).toBeVisible();

    await page.fill('.vault-input', 'TestVault');
    await expect(page.locator('#staleNotice')).toBeHidden();
  });

  test('canvas toggle marks and clears stale', async ({ page }) => {
    await page.goto('/');
    await page.fill('.vault-input', 'TestVault');
    await page.fill('.folder-input', 'Inbox');
    await page.click('#btnGenerate');

    await page.click('.canvas-checkbox');
    await expect(page.locator('#staleNotice')).toBeVisible();

    await page.click('.canvas-checkbox');
    await expect(page.locator('#staleNotice')).toBeHidden();
  });
});

// ── Boolean props (configure) ─────────────────────────────────────────────────

test.describe('Boolean props — configure view', () => {
  test('type icon starts as text (≡), toggles to boolean (☑)', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.click('.btn-add-prop');

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
    await page.fill('.vault-input', 'Vault');
    await page.fill('.folder-input', 'Inbox');
    await page.click('.btn-add-prop');
    await page.fill('.prop-key', 'published');
    await page.click('.prop-type-icon');          // switch to boolean
    await page.click('.prop-bool-check');          // set default = true
    await page.click('#btnGenerate');

    const url = await page.locator('#useUrlInput').inputValue();
    expect(url).toContain('instances=');

    // Decode the instances param and verify
    const params = new URL(url).searchParams;
    const instances = JSON.parse(atob(params.get('instances') ?? '')) as Array<{ props: PropConfig[] }>;
    expect(instances[0].props[0]).toMatchObject({ k: 'published', type: 'boolean', v: 'true' });
  });

  test('stale notice responds to boolean default checkbox change', async ({ page }) => {
    await page.goto('/');
    await page.fill('.vault-input', 'Vault');
    await page.fill('.folder-input', 'Inbox');
    await page.click('.btn-add-prop');
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
    const url = instancesUrl([{ vault: 'Vault', props: [{ k: 'published', v: 'false', type: 'boolean' }] }]);
    await page.goto(url);

    const cb = page.locator('.bool-prop-checkbox');
    await expect(cb).toBeVisible();
    await expect(cb).not.toBeChecked();
    await expect(page.locator('.bool-prop-checkbox + span, .bool-prop-checkbox ~ span')).toContainText('published');
    await page.screenshot({ path: ss(testInfo), fullPage: true });
  });

  test('boolean prop renders checked when default is true', async ({ page }) => {
    const url = instancesUrl([{ vault: 'Vault', props: [{ k: 'published', v: 'true', type: 'boolean' }] }]);
    await page.goto(url);

    await expect(page.locator('.bool-prop-checkbox')).toBeChecked();
  });

  test('text props do not appear as checkboxes in use view', async ({ page }) => {
    const url = instancesUrl([{ vault: 'Vault', props: [{ k: 'category', v: 'web', type: 'text' }] }]);
    await page.goto(url);
    await expect(page.locator('.bool-prop-checkbox')).toHaveCount(0);
  });
});

// ── Use view basics (mobile) ──────────────────────────────────────────────────

test.describe('Use view', () => {
  test.use({ ...iPhoneSE });

  test('shows vault info and configure link', async ({ page }) => {
    const url = instancesUrl([{ vault: 'MyVault', folder: 'Inbox', name: 'Capture', emoji: '📎' }]);
    await page.goto(url);
    await expect(page.locator('.vault-info')).toBeVisible();

    const link = page.locator('#configureLink');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('mode=configure');
    expect(href).toContain('instances=');
  });
});

// ── Edit configuration prefill ────────────────────────────────────────────────

test.describe('Edit configuration prefill', () => {
  test('prefills vault, folder, and name from instances param', async ({ page }) => {
    const instancesParam = encodeURIComponent(toBase64(JSON.stringify([{ vault: 'MyVault', folder: 'Inbox', name: 'Capture', emoji: '📎' }])));
    await page.goto(`/?mode=configure&instances=${instancesParam}`);
    await expect(page.locator('.vault-input')).toHaveValue('MyVault');
    await expect(page.locator('.folder-input')).toHaveValue('Inbox');
    await expect(page.locator('.shortcut-name-input')).toHaveValue('Capture');
  });

  test('prefills boolean prop type and default value', async ({ page }) => {
    const instancesParam = encodeURIComponent(toBase64(JSON.stringify([{ vault: 'Vault', props: [{ k: 'published', v: 'true', type: 'boolean' }] }])));
    await page.goto(`/?mode=configure&instances=${instancesParam}`);

    await expect(page.locator('.prop-type-icon')).toHaveText('☑');
    await expect(page.locator('.prop-bool-check')).toBeChecked();
  });
});

// ── Multi-instance configure view ─────────────────────────────────────────────

test.describe('Multi-instance configure view', () => {
  test('adding second instance creates second card', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.instance-card')).toHaveCount(1);
    await page.click('#btnAddInstance');
    await expect(page.locator('.instance-card')).toHaveCount(2);
  });

  test('each card vault field is independent', async ({ page }) => {
    await page.goto('/');
    await page.click('#btnAddInstance');

    const cards = page.locator('.instance-card');
    await cards.nth(0).locator('.vault-input').fill('VaultA');
    await cards.nth(1).locator('.vault-input').fill('VaultB');

    await expect(cards.nth(0).locator('.vault-input')).toHaveValue('VaultA');
    await expect(cards.nth(1).locator('.vault-input')).toHaveValue('VaultB');
  });

  test('generate produces URL with instances= param (single instance)', async ({ page }) => {
    await page.goto('/');
    await page.fill('.vault-input', 'Vault');
    await page.fill('.folder-input', 'Inbox');
    await page.click('#btnGenerate');

    const url = await page.locator('#useUrlInput').inputValue();
    expect(url).toContain('instances=');
    expect(url).not.toContain('v=');
  });

  test('generate with two instances encodes both in URL', async ({ page }) => {
    await page.goto('/');
    await page.click('#btnAddInstance');

    const cards = page.locator('.instance-card');
    await cards.nth(0).locator('.vault-input').fill('VaultA');
    await cards.nth(0).locator('.folder-input').fill('Inbox');
    await cards.nth(1).locator('.vault-input').fill('VaultB');
    await cards.nth(1).locator('.folder-input').fill('Inbox');

    await page.click('#btnGenerate');
    const url = await page.locator('#useUrlInput').inputValue();
    const params = new URL(url).searchParams;
    const instances = JSON.parse(atob(params.get('instances') ?? '')) as Array<{ vault: string }>;
    expect(instances).toHaveLength(2);
    expect(instances[0].vault).toBe('VaultA');
    expect(instances[1].vault).toBe('VaultB');
  });

  test('stale notice triggers when any instance field changes', async ({ page }) => {
    await page.goto('/');
    await page.click('#btnAddInstance');

    const cards = page.locator('.instance-card');
    await cards.nth(0).locator('.vault-input').fill('VaultA');
    await cards.nth(0).locator('.folder-input').fill('Inbox');
    await cards.nth(1).locator('.vault-input').fill('VaultB');
    await cards.nth(1).locator('.folder-input').fill('Inbox');
    await page.click('#btnGenerate');

    await expect(page.locator('#staleNotice')).toBeHidden();
    await cards.nth(1).locator('.vault-input').fill('VaultBEdited');
    await expect(page.locator('#staleNotice')).toBeVisible();
  });

  test('decoded instances JSON uses readable keys', async ({ page }) => {
    await page.goto('/');
    await page.fill('.vault-input', 'MyVault');
    await page.fill('.folder-input', 'Notes');
    await page.fill('.shortcut-name-input', 'My Capture');
    await page.click('#btnGenerate');

    const url = await page.locator('#useUrlInput').inputValue();
    const params = new URL(url).searchParams;
    const instances = JSON.parse(atob(params.get('instances') ?? '')) as Array<{ vault: string; folder: string; name: string }>;
    expect(instances[0]).toMatchObject({ vault: 'MyVault', folder: 'Notes', name: 'My Capture' });
  });
});

// ── Multi-instance use view ───────────────────────────────────────────────────

test.describe('Multi-instance use view', () => {
  test('two-instance URL shows picker, form hidden', async ({ page }) => {
    const url = instancesUrl([
      { vault: 'VaultA', name: 'Work' },
      { vault: 'VaultB', name: 'Personal' },
    ]);
    await page.goto(url);

    await expect(page.locator('#instancePicker')).toBeVisible();
    await expect(page.locator('#captureForm')).toBeHidden();
  });

  test('picker shows one option per instance', async ({ page }) => {
    const url = instancesUrl([
      { vault: 'VaultA', name: 'Work' },
      { vault: 'VaultB', name: 'Personal' },
    ]);
    await page.goto(url);

    await expect(page.locator('.instance-option')).toHaveCount(2);
    await expect(page.locator('.instance-option').nth(0)).toContainText('Work');
    await expect(page.locator('.instance-option').nth(1)).toContainText('Personal');
  });

  test('clicking option hides picker and shows form', async ({ page }) => {
    const url = instancesUrl([
      { vault: 'VaultA', name: 'Work' },
      { vault: 'VaultB', name: 'Personal' },
    ]);
    await page.goto(url);

    await page.locator('.instance-option').nth(1).click();

    await expect(page.locator('#instancePicker')).toBeHidden();
    await expect(page.locator('#captureForm')).toBeVisible();
  });

  test('form shows correct vault for selected instance', async ({ page }) => {
    const url = instancesUrl([
      { vault: 'VaultA', name: 'Work' },
      { vault: 'VaultB', folder: 'Notes', name: 'Personal' },
    ]);
    await page.goto(url);

    await page.locator('.instance-option').nth(1).click();

    await expect(page.locator('.vault-info')).toContainText('VaultB');
    await expect(page.locator('.vault-info')).toContainText('Notes');
  });

  test('single-instance URL skips picker and goes straight to form', async ({ page }) => {
    const url = instancesUrl([{ vault: 'OnlyVault', name: 'Solo' }]);
    await page.goto(url);

    await expect(page.locator('#instancePicker')).toBeHidden();
    await expect(page.locator('#captureForm')).toBeVisible();
    await expect(page.locator('.vault-info')).toContainText('OnlyVault');
  });
});
