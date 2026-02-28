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
 * Generate a filename slug from a title string.
 * Max 40 chars, lowercased, spaces/special chars → hyphens.
 */
export function makeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
}

/**
 * Generate a timestamp string. Format: YYYYMMDDTHHmmss
 */
export function makeTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

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
  for (const { k, v } of props) {
    if (k) lines.push(`${k}: "${escapeFrontmatter(v)}"`);
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
