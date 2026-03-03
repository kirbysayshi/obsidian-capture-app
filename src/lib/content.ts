import { Readability } from '@mozilla/readability';

export interface ArticleContent {
  title: string;
  excerpt: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  textContent: string;
}

export interface YouTubeContent {
  title: string;
  channel: string;
  subs: string;
  description: string;
}

/**
 * Returns true for youtube.com/watch and m.youtube.com/watch URLs.
 */
export function isYouTubeVideo(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'www.youtube.com' ||
        u.hostname === 'youtube.com' ||
        u.hostname === 'm.youtube.com') &&
      u.pathname === '/watch'
    );
  } catch {
    return false;
  }
}

/**
 * Extract structured content from a YouTube watch page.
 *
 * Parses the ytInitialData JSON blob embedded in the page's <script> tags.
 * Returns null if the JSON cannot be found or parsed — this likely means
 * YouTube has changed their data model.
 */
export function extractYouTubeContent(html: string): YouTubeContent | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ytData = parseYtInitialData(doc);
    if (!ytData) return null;
    return extractFromYtData(ytData);
  } catch {
    return null;
  }
}

/**
 * Extract article content from an HTML string using Readability.
 */
export function extractContent(html: string, url: string): ArticleContent | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const base = doc.createElement('base');
    base.href = url;
    doc.head.appendChild(base);
    const reader = new Readability(doc);
    const article = reader.parse();
    if (!article) return null;
    return {
      title: article.title ?? '',
      excerpt: article.excerpt ?? '',
      byline: article.byline ?? '',
      siteName: article.siteName ?? '',
      publishedTime: article.publishedTime ?? '',
      textContent: normalizeText(article.textContent ?? ''),
    };
  } catch {
    return null;
  }
}

// ─── ytInitialData parsing ────────────────────────────────────────────────────

/**
 * Find and parse the ytInitialData JSON blob from a YouTube page's script tags.
 *
 * YouTube embeds the full page data as:
 *   <script>var ytInitialData = {...};</script>
 *
 * We locate the opening brace and scan forward with a string-aware brace
 * counter to find the exact end of the JSON object, then JSON.parse it.
 */
function parseYtInitialData(doc: Document): Record<string, unknown> | null {
  for (const script of doc.querySelectorAll('script')) {
    const text = script.textContent ?? '';
    if (!text.includes('ytInitialData')) continue;

    const jsonStart = text.indexOf('{');
    if (jsonStart === -1) continue;

    // String-aware brace counter so we don't mis-count braces inside strings
    let depth = 0;
    let inString = false;
    let escape = false;
    let jsonEnd = -1;

    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { jsonEnd = i; break; }
      }
    }

    if (jsonEnd === -1) continue;
    try {
      return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Navigate ytInitialData to pull out title, channel, subscriber count and full description.
 *
 * YouTube stores the description as an array of "runs" — plain-text segments
 * and hyperlinks — inside videoSecondaryInfoRenderer. Concatenating run.text
 * gives the complete, untruncated description.
 *
 * Desktop uses twoColumnWatchNextResults; mobile uses singleColumnWatchNextResults.
 */
function extractFromYtData(data: Record<string, unknown>): YouTubeContent | null {
  // Desktop layout
  const desktopContents = asArr(
    dig(data, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents'),
  );

  // Mobile layout: singleColumnWatchNextResults → results → contents → slimVideoMetadataRenderer, etc.
  // The video info is nested inside slimVideoMetadataRenderer and slimOwnerRenderer.
  const mobileItems = asArr(
    dig(data, 'contents', 'singleColumnWatchNextResults', 'results', 'results', 'contents'),
  );

  let title = '';
  let channel = '';
  let subs = '';
  let description = '';

  // Try desktop path first
  for (const item of desktopContents) {
    const vpir = dig(item, 'videoPrimaryInfoRenderer');
    if (vpir) {
      title = runsText(dig(vpir, 'title', 'runs'));
    }

    const vsir = dig(item, 'videoSecondaryInfoRenderer');
    if (vsir) {
      description =
        runsText(dig(vsir, 'description', 'runs')) ||
        asStr(dig(vsir, 'attributedDescription', 'content'));

      const owner = dig(vsir, 'owner', 'videoOwnerRenderer');
      if (owner) {
        channel = runsText(dig(owner, 'title', 'runs'));
        subs =
          asStr(dig(owner, 'subscriberCountText', 'simpleText')) ||
          runsText(dig(owner, 'subscriberCountText', 'runs'));
      }
    }
  }

  // Try mobile path if desktop came up empty
  if (!title && !description) {
    for (const item of mobileItems) {
      const svmr = dig(item, 'slimVideoMetadataRenderer');
      if (svmr) {
        title = runsText(dig(svmr, 'title', 'runs'));
        description =
          runsText(dig(svmr, 'description', 'runs')) ||
          asStr(dig(svmr, 'description', 'simpleText'));
      }

      const sor = dig(item, 'slimOwnerRenderer');
      if (sor) {
        channel = runsText(dig(sor, 'title', 'runs'));
        subs =
          asStr(dig(sor, 'collapsedSubtitle', 'simpleText')) ||
          runsText(dig(sor, 'collapsedSubtitle', 'runs'));
      }

      // Also try engagementPanels path for description on newer mobile layouts
      const epvmr = dig(item, 'engagementPanelSectionListRenderer',
        'content', 'structuredDescriptionContentRenderer',
        'items');
      if (epvmr && !description) {
        for (const ep of asArr(epvmr)) {
          const snippet = dig(ep, 'videoDescriptionHeaderRenderer', 'description', 'content');
          if (typeof snippet === 'string' && snippet) {
            description = snippet;
            break;
          }
        }
      }
    }
  }

  if (!title && !description) return null;
  return { title, channel, subs, description: normalizeText(description) };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Safely navigate a deeply nested unknown structure. */
function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Cast to string, returning '' for non-strings. */
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Cast to array, returning [] for non-arrays. */
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Concatenate the `text` field from a YouTube runs array.
 * Each run is either plain text or a hyperlink; joining gives the full string.
 */
function runsText(runs: unknown): string {
  return asArr(runs)
    .map(r => asStr(dig(r, 'text')))
    .join('');
}

/**
 * Normalize whitespace in extracted text:
 * - Trim each line
 * - Collapse consecutive blank lines to one
 */
function normalizeText(text: string): string {
  const lines = text.split('\n').map(l => l.trim());
  const result: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    if (line === '') {
      if (!prevBlank) result.push('');
      prevBlank = true;
    } else {
      result.push(line);
      prevBlank = false;
    }
  }
  return result.join('\n').trim();
}
