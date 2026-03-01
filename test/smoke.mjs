/**
 * Smoke tests for obsidian-capture-app.
 * Spawns the Vite dev server, runs tests, then kills it.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const PORT = 5174;
const BASE = `http://localhost:${PORT}/`;
const SS_DIR = path.join(ROOT, 'test/screenshots');
const iPhone = devices['iPhone SE'];

// ── Start Vite dev server ────────────────────────────────────────────────────
const server = spawn('pnpm', ['exec', 'vite', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: 'pipe',
});

// Kill server on exit no matter what
function shutdown() { server.kill(); }
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(1); });
process.on('uncaughtException', (e) => { console.error(e); shutdown(); process.exit(1); });

// Wait until Vite is ready
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (d.toString().includes('Local')) resolve(); });
  server.stderr.on('data', (d) => { if (d.toString().includes('Local')) resolve(); });
  setTimeout(() => reject(new Error('Vite did not start in time')), 10_000);
});
await sleep(300); // give it a moment to settle

// ── Helpers ──────────────────────────────────────────────────────────────────
import { mkdir } from 'node:fs/promises';
await mkdir(SS_DIR, { recursive: true });

let passed = 0, failed = 0;
function pass(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail = '') { console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; }
function check(label, ok, detail = '') { ok ? pass(label) : fail(label, detail); }

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SS_DIR, `${name}.png`), fullPage: true });
}

// ── Tests ────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

// 1. Desktop configure view
console.log('\n── Configure view (desktop) ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await screenshot(page, '01-desktop-configure');
  check('renders vault input', await page.locator('#vault').isVisible());
  check('renders emoji input', await page.locator('#shortcutEmoji').isVisible());
  check('output hidden initially', !(await page.locator('#outputSection').isVisible()));
  await ctx.close();
}

// 2. Mobile configure view — emoji row layout
console.log('\n── Emoji row layout (iPhone SE) ──');
{
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await screenshot(page, '02-mobile-configure');

  const emojiBox = await page.locator('#shortcutEmoji').boundingBox();
  const nameBox  = await page.locator('#shortcutName').boundingBox();
  check('emoji input ≤ 60px wide', emojiBox?.width <= 60, `got ${emojiBox?.width?.toFixed(1)}px`);
  check('name input > 150px wide', nameBox?.width > 150, `got ${nameBox?.width?.toFixed(1)}px`);
  check('name wider than emoji',   nameBox?.width > emojiBox?.width);
  await ctx.close();
}

// 3. Generate + stale notice
console.log('\n── Stale notice ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill('#vault', 'TestVault');
  await page.click('#btnGenerate');
  await page.locator('#outputSection').waitFor({ state: 'visible' });

  check('notice hidden after Generate', !(await page.locator('#staleNotice').isVisible()));

  await page.fill('#vault', 'TestVaultEdited');
  check('notice shown after edit', await page.locator('#staleNotice').isVisible());

  await page.fill('#vault', 'TestVault');
  check('notice gone after revert', !(await page.locator('#staleNotice').isVisible()));

  // Canvas toggle also triggers stale
  await page.click('#canvas');
  check('notice shown after canvas toggle', await page.locator('#staleNotice').isVisible());
  await page.click('#canvas'); // revert
  check('notice gone after canvas revert', !(await page.locator('#staleNotice').isVisible()));

  await screenshot(page, '03-stale-notice');
  await ctx.close();
}

// 4. Use view — mobile
console.log('\n── Use view (iPhone SE) ──');
{
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?v=MyVault&f=Inbox&n=Capture&e=%F0%9F%93%8E`);
  await screenshot(page, '04-mobile-use');

  check('vault info visible', await page.locator('.vault-info').isVisible());
  check('configure link present', await page.locator('#configureLink').isVisible());

  const href = await page.locator('#configureLink').getAttribute('href');
  check('configure link has mode=configure', href?.includes('mode=configure'));
  check('configure link has vault param',    href?.includes('v=MyVault'));
  await ctx.close();
}

// 5. Edit configuration round-trip
console.log('\n── Edit configuration prefill ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?mode=configure&v=MyVault&f=Inbox&n=Capture&e=%F0%9F%93%8E`);
  await screenshot(page, '05-configure-prefilled');

  check('vault prefilled',  (await page.locator('#vault').inputValue()) === 'MyVault');
  check('folder prefilled', (await page.locator('#folder').inputValue()) === 'Inbox');
  check('name prefilled',   (await page.locator('#shortcutName').inputValue()) === 'Capture');
  await ctx.close();
}

await browser.close();
server.kill();

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`Screenshots saved to test/screenshots/`);
process.exit(failed > 0 ? 1 : 0);
