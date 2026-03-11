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
  date?: Date;
}

/**
 * Build an obsidian://new URI.
 */
export function buildObsidianUri({
  vault,
  folder,
  filename,
  content,
}: ObsidianUriParams): string {
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
    String(date.getFullYear()) +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    '.' +
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
  date,
}: NoteContentParams): string {
  const created = (date ?? new Date()).toISOString().slice(0, 19);
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
  date,
}: NoteContentParams): string {
  const lines: string[] = [];
  lines.push(`**Created:** ${makeHumanTimestamp(date)}`);
  if (what) lines.push(`**What:** ${what}`);
  if (who) lines.push(`**Who:** ${who}`);
  if (why) lines.push(`**Why:** ${why}`);
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
 * - Note text node at (0,0) as the anchor
 * - Each URL becomes a link node arranged in a golden-angle spiral outward from the note
 * - Edges connect each link node back to the note
 */
export function buildCanvasContent(
  noteText: string,
  urls: string[] = [],
): string {
  const NOTE_W = 460,
    NOTE_H = 360,
    LINK_W = 400,
    LINK_H = 300,
    GAP = 60;
  const NOTE_CX = NOTE_W / 2,
    NOTE_CY = NOTE_H / 2;

  const nodes: object[] = [];
  const edges: object[] = [];

  if (noteText) {
    nodes.push({
      id: 'note',
      type: 'text',
      text: noteText,
      x: 0,
      y: 0,
      width: NOTE_W,
      height: NOTE_H,
    });
  }

  // Golden angle spiral: successive nodes spread evenly without clustering
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.5°
  const baseRadius = Math.hypot(NOTE_W / 2 + LINK_W / 2 + GAP, NOTE_H / 2);

  urls.forEach((url, i) => {
    const angle = i * GOLDEN;
    const radius = baseRadius + i * (LINK_W * 0.4 + GAP);
    const lx = Math.round(NOTE_CX + radius * Math.cos(angle) - LINK_W / 2);
    const ly = Math.round(NOTE_CY + radius * Math.sin(angle) - LINK_H / 2);
    nodes.push({
      id: `l${i}`,
      type: 'link',
      url,
      x: lx,
      y: ly,
      width: LINK_W,
      height: LINK_H,
    });
    if (noteText) {
      edges.push({
        id: `e${i}`,
        fromNode: 'note',
        fromSide: angleToSide(angle),
        toNode: `l${i}`,
        toSide: angleToSide(angle + Math.PI),
      });
    }
  });

  return JSON.stringify({ nodes, edges });
}

function angleToSide(angle: number): 'top' | 'bottom' | 'left' | 'right' {
  const TWO_PI = Math.PI * 2;
  const a = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  if (a < Math.PI / 4 || a >= (7 * Math.PI) / 4) return 'right';
  if (a < (3 * Math.PI) / 4) return 'bottom';
  if (a < (5 * Math.PI) / 4) return 'left';
  return 'top';
}

function escapeFrontmatter(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}
