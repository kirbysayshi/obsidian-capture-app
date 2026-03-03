import type { Prop } from './config.js';

export interface ObsidianUriParams {
  vault: string;
  folder: string;
  filename: string;
  content: string;
}

export interface NoteContentParams {
  what: string;
  who: string;
  why: string;
  props?: Prop[];
  bodyText?: string;
  url?: string;
}

/**
 * Build an obsidian://new URI.
 */
export function buildObsidianUri({ vault, folder, filename, content }: ObsidianUriParams): string {
  const file = folder ? `${folder}/${filename}` : filename;
  // Use encodeURIComponent — URLSearchParams encodes spaces as '+' which Obsidian misreads
  return `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}&content=${encodeURIComponent(content)}`;
}

/**
 * Generate a human-readable filename slug from a title.
 * Strips characters invalid in filenames, preserves casing and spaces.
 * Max 60 chars.
 */
export function makeReadableSlug(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
}

/**
 * Generate a human-readable timestamp. Format: YYYY-MM-DD HH.mm
 * Dots separate hours and minutes to keep it valid in all OS filenames.
 */
export function makeHumanTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(date.getFullYear()) + '-' +
    pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' +
    pad(date.getHours()) + '.' +
    pad(date.getMinutes())
  );
}

const RESERVED_PROP_KEYS = new Set(['created', 'what', 'who', 'why']);

/**
 * Build the full note content (markdown frontmatter + body).
 */
export function buildNoteContent({
  what,
  who,
  why,
  props = [],
  bodyText = '',
  url = '',
}: NoteContentParams): string {
  const created = new Date().toISOString().slice(0, 19);
  const lines: string[] = ['---'];
  lines.push(`created: ${created}`);
  lines.push(`what: "${escapeFrontmatter(what)}"`);
  if (who) lines.push(`who: "${escapeFrontmatter(who)}"`);
  for (const { k, v, type } of props) {
    if (!k || RESERVED_PROP_KEYS.has(k)) continue;
    if (type === 'boolean') {
      lines.push(`${k}: ${v === 'true' ? 'true' : 'false'}`);
    } else {
      lines.push(`${k}: "${escapeFrontmatter(v)}"`);
    }
  }
  if (why) lines.push(`why: "${escapeFrontmatter(why)}"`);
  lines.push('---');
  lines.push('');
  if (bodyText) {
    lines.push(bodyText.trim());
    lines.push('');
  }
  if (url) {
    lines.push(`Source: ${url}`);
  }
  return lines.join('\n');
}

/**
 * Build plain markdown text for a canvas text node — no frontmatter,
 * since Obsidian canvas ignores and hides YAML frontmatter in text nodes.
 */
export function buildCanvasNoteText({
  what,
  who,
  why,
  bodyText = '',
  url = '',
}: NoteContentParams): string {
  const lines: string[] = [];
  lines.push(`**Created:** ${makeHumanTimestamp()}`);
  if (what) lines.push(`**What:** ${what}`);
  if (who)  lines.push(`**Who:** ${who}`);
  if (why)  lines.push(`**Why:** ${why}`);
  if (bodyText) {
    lines.push('');
    lines.push(bodyText.trim());
  }
  if (url) {
    lines.push('');
    lines.push(`Source: ${url}`);
  }
  return lines.join('\n');
}

/**
 * Build a canvas note (JSON).
 * - URL + text → link node and text node side-by-side, connected by an edge
 * - URL only  → single link node
 * - Text only → single text node
 */
export function buildCanvasContent(url: string, noteText: string): string {
  const W = 460, H = 360, GAP = 40;
  const nodes: object[] = [];
  const edges: object[] = [];

  if (url)      nodes.push({ id: '1', type: 'link', url,            x: 0,                   y: 0, width: W, height: H });
  if (noteText) nodes.push({ id: '2', type: 'text', text: noteText, x: url ? W + GAP : 0,  y: 0, width: W, height: H });
  if (url && noteText) edges.push({ id: 'e1', fromNode: '1', fromSide: 'right', toNode: '2', toSide: 'left' });

  return JSON.stringify({ nodes, edges });
}

function escapeFrontmatter(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}
