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
 * Strategy:
 *   1. Parse ytInitialData from the page's embedded <script> tag — this contains
 *      the full, untruncated description before the "…more" button hides it.
 *   2. Fall back to DOM selectors if the JSON parse fails.
 */
export function extractYouTubeContent(html: string): YouTubeContent | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const ytData = parseYtInitialData(doc);
    if (ytData) {
      const result = extractFromYtData(ytData);
      if (result) return result;
    }

    // Fallback: targeted DOM selectors
    return extractFromDom(doc);
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
 */
function extractFromYtData(data: Record<string, unknown>): YouTubeContent | null {
  // The main content lives under this path in twoColumnWatchNextResults
  const contents = asArr(
    dig(data, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents'),
  );

  let title = '';
  let channel = '';
  let subs = '';
  let description = '';

  for (const item of contents) {
    // videoPrimaryInfoRenderer → title
    const vpir = dig(item, 'videoPrimaryInfoRenderer');
    if (vpir) {
      title = runsText(dig(vpir, 'title', 'runs'));
    }

    // videoSecondaryInfoRenderer → description + channel
    const vsir = dig(item, 'videoSecondaryInfoRenderer');
    if (vsir) {
      // Full description via runs (untruncated)
      description =
        runsText(dig(vsir, 'description', 'runs')) ||
        // Newer format: attributedDescription.content is a plain string
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

  if (!title && !description) return null;
  return { title, channel, subs, description: normalizeText(description) };
}

/**
 * Fallback: extract what we can from the rendered DOM using targeted selectors.
 * Avoids the recommendations panel entirely.
 */
function extractFromDom(doc: Document): YouTubeContent | null {
  const title = queryText(doc,
    'ytd-watch-metadata h1 yt-formatted-string',
    'ytd-video-primary-info-renderer h1 yt-formatted-string',
    '#video-title',
  );
  const channel = queryText(doc,
    'ytd-video-owner-renderer ytd-channel-name yt-formatted-string',
    '#channel-name yt-formatted-string',
    '#owner-name a',
  );
  const subs = queryText(doc, '#owner-sub-count');
  const rawDesc = queryText(doc,
    'ytd-expandable-video-description-body-renderer yt-attributed-string',
    '#attributed-snippet-text',
    'ytd-video-description-header-renderer yt-formatted-string#snippet-text',
    '#description-text',
  );

  if (!title && !channel && !rawDesc) return null;
  return { title, channel, subs, description: normalizeText(rawDesc) };
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

/** Try each selector in order; return the first non-empty textContent. */
function queryText(doc: Document, ...selectors: string[]): string {
  for (const sel of selectors) {
    const text = doc.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
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
