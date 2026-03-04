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
 * Finds the ytInitialData JSON blob directly in the HTML string (no DOMParser),
 * then navigates the data structure to pull out title/channel/description.
 * Returns null if the JSON cannot be found or parsed — this likely means
 * YouTube has changed their data model.
 *
 * Pass a `diag` array to collect diagnostic log lines.
 */
export function extractYouTubeContent(html: string, diag?: string[]): YouTubeContent | null {
  try {
    diag?.push(`html.length = ${html.length}`);
    const ytData = parseYtInitialData(html, diag);
    if (!ytData) return null;
    return extractFromYtData(ytData, diag);
  } catch (err) {
    diag?.push(`uncaught error: ${err}`);
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
 * Find and evaluate the ytInitialData assignment from the HTML string.
 *
 * Desktop YouTube embeds it as a JSON object literal:
 *   <script>var ytInitialData = {...};</script>
 *
 * Mobile YouTube embeds it as a JS string literal with hex escapes:
 *   <script>var ytInitialData = '\x7b\x22...\x7d';</script>
 *
 * We use new Function() to evaluate the assignment so JS handles all escape
 * sequences natively. The result may be a parsed object (desktop) or a JSON
 * string (mobile), so we JSON.parse string results.
 */
function parseYtInitialData(html: string, diag?: string[]): Record<string, unknown> | null {
  const MARKER = 'var ytInitialData = ';
  const markerIdx = html.indexOf(MARKER);
  diag?.push(`marker idx: ${markerIdx}`);
  if (markerIdx === -1) return null;

  const jsonStart = markerIdx + MARKER.length;
  // Try lowercase first (standard), then uppercase fallback
  let scriptEnd = html.indexOf('</script>', jsonStart);
  if (scriptEnd === -1) scriptEnd = html.indexOf('</SCRIPT>', jsonStart);
  diag?.push(`</script> idx: ${scriptEnd}`);
  if (scriptEnd === -1) return null;

  // Slice the full assignment statement (var ytInitialData = ...;)
  const scriptBody = html.slice(markerIdx, scriptEnd).trim();
  diag?.push(`scriptBody[0..120]: ${scriptBody.slice(0, 120)}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const raw = new Function(`${scriptBody}; return ytInitialData;`)();
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    diag?.push(`eval: OK (type was ${typeof raw})`);
    return data as Record<string, unknown>;
  } catch (err) {
    diag?.push(`eval error: ${err}`);
    return null;
  }
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
function extractFromYtData(data: Record<string, unknown>, diag?: string[]): YouTubeContent | null {
  // Desktop layout
  const desktopContents = asArr(
    dig(data, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents'),
  );

  // Mobile layout: singleColumnWatchNextResults → results → contents → slimVideoMetadataRenderer, etc.
  // The video info is nested inside slimVideoMetadataRenderer and slimOwnerRenderer.
  const mobileItems = asArr(
    dig(data, 'contents', 'singleColumnWatchNextResults', 'results', 'results', 'contents'),
  );

  diag?.push(`desktop contents: ${desktopContents.length}, mobile items: ${mobileItems.length}`);
  diag?.push(`top-level contents keys: ${Object.keys((data.contents ?? {}) as object).join(', ')}`);

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

  // Try mobile path if desktop came up empty.
  // Mobile structure: singleColumnWatchNextResults → results.results.contents →
  //   slimVideoMetadataSectionRenderer.contents →
  //     slimVideoInformationRenderer  (title)
  //     slimOwnerRenderer             (channel, subs)
  // Description lives in engagementPanels[id=video-description-ep-identifier] →
  //   structuredDescriptionContentRenderer.items →
  //     expandableVideoDescriptionBodyRenderer.attributedDescriptionBodyText.content
  if (!title && !description) {
    for (const item of mobileItems) {
      for (const sub of asArr(dig(item, 'slimVideoMetadataSectionRenderer', 'contents'))) {
        const svir = dig(sub, 'slimVideoInformationRenderer');
        if (svir) title = runsText(dig(svir, 'title', 'runs'));

        const sor = dig(sub, 'slimOwnerRenderer');
        if (sor) {
          channel = runsText(dig(sor, 'title', 'runs'));
          subs = runsText(dig(sor, 'collapsedSubtitle', 'runs')) ||
                 asStr(dig(sor, 'collapsedSubtitle', 'simpleText'));
        }
      }
    }

    // Description is in a named engagement panel
    for (const panel of asArr(dig(data, 'engagementPanels'))) {
      const epslr = dig(panel, 'engagementPanelSectionListRenderer');
      if (asStr(dig(epslr, 'panelIdentifier')) !== 'video-description-ep-identifier') continue;
      for (const item of asArr(dig(epslr, 'content', 'structuredDescriptionContentRenderer', 'items'))) {
        const body = dig(item, 'expandableVideoDescriptionBodyRenderer', 'attributedDescriptionBodyText', 'content');
        if (typeof body === 'string' && body) { description = body; break; }
      }
    }
  }

  diag?.push(`extracted — title: ${title.slice(0, 60)}, channel: ${channel}, desc.length: ${description.length}`);
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
