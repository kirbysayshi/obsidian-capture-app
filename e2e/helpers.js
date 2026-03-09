/**
 * Shared helpers for e2e tests: fixture parsing utilities.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export const FIXTURES_DIR = 'e2e/fixtures';

/** Parse a minimal YAML subset: scalar strings and one string-list field. */
export function parseFrontmatter(text) {
  const fm = {};
  let currentListKey = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const listItem = line.match(/^  - (.*)$/);
    if (listItem && currentListKey) {
      const val = listItem[1];
      // Strip surrounding single or double quotes used as YAML string delimiters
      fm[currentListKey].push(
        (val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))
          ? val.slice(1, -1)
          : val,
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
export function parseFixture(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Invalid fixture format: ${filePath}`);
  const [, fmText, html] = match;
  const fm = parseFrontmatter(fmText);
  return { name: fm.name, url: fm.url, expectContains: fm.expectContains ?? [], html };
}

export const FIXTURES = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => parseFixture(join(FIXTURES_DIR, f)));

export const VAULT = 'TestVault';
export const FOLDER = 'Inbox';
export const INSTANCES_JSON = JSON.stringify([{ vault: VAULT, folder: FOLDER }]);
export const INSTANCES_PARAM = encodeURIComponent(btoa(
  Array.from(new TextEncoder().encode(INSTANCES_JSON))
    .map(b => String.fromCharCode(b))
    .join(''),
));
export const CAPTURE_BASE = `http://localhost:5174/?instances=${INSTANCES_PARAM}`;
