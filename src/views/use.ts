import { decodeConfig } from '../lib/config.js';
import {
  buildObsidianUri,
  buildNoteContent,
  buildCanvasContent,
  buildCanvasNoteText,
  makeReadableSlug,
  makeHumanTimestamp,
} from '../lib/obsidian.js';
import { extractContent, extractYouTubeContent, extractFromYtData, isYouTubeVideo } from '../lib/content.js';

export function renderUse(root: HTMLElement, params: URLSearchParams): void {
  const config = decodeConfig(params);
  const isBookmarklet = params.get('mode') === 'bm';

  // Apply custom name to page title and iOS home screen shortcut name
  if (config.name) {
    document.title = config.name;
    let metaTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (!metaTitle) {
      metaTitle = document.createElement('meta');
      metaTitle.name = 'apple-mobile-web-app-title';
      document.head.appendChild(metaTitle);
    }
    metaTitle.content = config.name;
  }

  // Generate a home screen icon from the emoji (or first letter of name) and
  // set it as the apple-touch-icon so iOS picks it up on "Add to Home Screen"
  generateHomeIcon(config.emoji, config.name);

  root.innerHTML = `
    <div class="use-view">
      <h1>
        Capture
        ${config.canvas ? '<span class="canvas-badge">Canvas</span>' : ''}
      </h1>
      <p class="vault-info">→ ${config.vault}${config.folder ? ' / ' + config.folder : ''}</p>
      <a class="configure-link" id="configureLink" href="#">Edit configuration</a>

      <div class="field">
        <label for="fieldWhat">What</label>
        ${isBookmarklet ? '<div class="loading-indicator" id="loadingIndicator">Extracting page content</div>' : ''}
        <textarea id="fieldWhat" placeholder="URL, title, notes…" rows="6"></textarea>
      </div>

      <div class="field">
        <label for="fieldWho">Who</label>
        <input type="text" id="fieldWho" placeholder="Person or source">
      </div>

      <div class="field">
        <label for="fieldWhy">Why</label>
        <textarea id="fieldWhy" placeholder="Why does this matter?" rows="3"></textarea>
      </div>

      <div id="boolPropsSection"></div>

      <div class="btn-row">
        <button class="btn-save" id="btnSave">Save to Obsidian</button>
        <button class="btn-cancel secondary" id="btnCancel">Cancel</button>
      </div>

      <div id="contentPreview" class="content-preview" style="display:none">
        <label>Clipped content</label>
        <pre id="contentPreviewText"></pre>
      </div>

      <details id="debugDetails" class="debug-details">
        <summary>Debug <button id="btnCopyDebug" class="debug-copy-btn" type="button">Copy</button></summary>
        <pre id="debugLog"></pre>
      </details>
    </div>
  `;

  const fieldWhat = root.querySelector<HTMLTextAreaElement>('#fieldWhat')!;
  const fieldWho = root.querySelector<HTMLInputElement>('#fieldWho')!;
  const fieldWhy = root.querySelector<HTMLTextAreaElement>('#fieldWhy')!;
  const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;
  const loadingIndicator = root.querySelector<HTMLElement>('#loadingIndicator');
  const contentPreview = root.querySelector<HTMLElement>('#contentPreview')!;
  const contentPreviewText = root.querySelector<HTMLElement>('#contentPreviewText')!;
  const btnCancel = root.querySelector<HTMLButtonElement>('#btnCancel')!;
  const configureLink = root.querySelector<HTMLAnchorElement>('#configureLink')!;
  const boolPropsSection = root.querySelector<HTMLElement>('#boolPropsSection')!;
  const debugLog = root.querySelector<HTMLElement>('#debugLog')!;
  const btnCopyDebug = root.querySelector<HTMLButtonElement>('#btnCopyDebug')!;

  function dbg(...lines: string[]): void {
    debugLog.textContent += lines.join('\n') + '\n';
  }

  btnCopyDebug.addEventListener('click', (e) => {
    e.preventDefault(); // don't toggle the <details>
    navigator.clipboard.writeText(debugLog.textContent ?? '').then(() => {
      btnCopyDebug.textContent = 'Copied!';
      setTimeout(() => { btnCopyDebug.textContent = 'Copy'; }, 1500);
    }).catch(() => {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(debugLog);
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  });

  // Render boolean props as checkboxes
  const booleanProps = config.props.filter(p => p.type === 'boolean');
  for (const prop of booleanProps) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
      <label class="checkbox-row">
        <input type="checkbox" class="bool-prop-checkbox" data-key="${escProp(prop.k)}"${prop.v === 'true' ? ' checked' : ''}>
        <span>${prop.k}</span>
      </label>
    `;
    boolPropsSection.appendChild(field);
  }

  // Build configure URL: same params + mode=configure (drops mode=bm if present)
  const configureParams = new URLSearchParams(params);
  configureParams.delete('mode');
  configureParams.set('mode', 'configure');
  configureLink.href = `${window.location.pathname}?${configureParams}`;

  let extractedUrl = '';
  let extractedBodyText = '';  // title + body combined, goes into note body
  let extractedTitle = '';     // used for filename slug

  function resetForm(): void {
    fieldWhat.value = '';
    fieldWho.value = '';
    fieldWhy.value = '';
    extractedUrl = '';
    extractedBodyText = '';
    extractedTitle = '';
    contentPreview.style.display = 'none';
    contentPreviewText.textContent = '';
    // Reset boolean prop checkboxes to their configured defaults
    for (const prop of booleanProps) {
      const cb = boolPropsSection.querySelector<HTMLInputElement>(`[data-key="${escProp(prop.k)}"]`);
      if (cb) cb.checked = prop.v === 'true';
    }
  }

  btnCancel.addEventListener('click', () => {
    if (isBookmarklet) {
      window.parent.postMessage({ type: 'close' }, '*');
    } else if (isStandalone()) {
      resetForm();
    } else {
      window.history.back();
    }
  });

  if (isBookmarklet) {
    const hashData = location.hash.slice(1);
    // params.get() decodes once; Shortcuts' URL-type conversion can double-encode
    // (%3A → %253A), so decode a second time to recover the original value.
    const sourceUrl = safeDecodeUri(params.get('url') ?? '');
    const sourceTitle = safeDecodeUri(params.get('title') ?? '');

    extractedUrl = sourceUrl;
    dbg(`url: ${sourceUrl}`, `hash.length: ${hashData.length}`, `isYT: ${isYouTubeVideo(sourceUrl)}`);

    if (hashData) {
      try {
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(hashData), c => c.charCodeAt(0))
        );
        // Fragment is JSON {html, yt?} (bookmarklet) or raw HTML (Shortcuts path).
        let html: string;
        let ytDataObj: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(decoded) as { html: string; yt?: Record<string, unknown> };
          html = parsed.html;
          ytDataObj = parsed.yt ?? null;
        } catch {
          html = decoded;
        }
        dbg(`html.length: ${html.length}`);

        if (isYouTubeVideo(sourceUrl)) {
          const diag: string[] = [];
          // Prefer pre-extracted subset from bookmarklet; fall back to searching HTML
          // (works when HTML still contains scripts, e.g. a future Shortcuts path).
          const yt = ytDataObj
            ? extractFromYtData(ytDataObj, diag)
            : extractYouTubeContent(html, diag);
          dbg(...diag);
          extractedTitle = yt?.title || sourceTitle || '';

          if (yt) {
            const parts: string[] = [];
            parts.push(`# ${yt.title}`);
            const channelLine = [yt.channel, yt.subs].filter(Boolean).join(' · ');
            if (channelLine) parts.push(`**Channel:** ${channelLine}`);
            if (yt.description) parts.push(`**Description:**\n\n${yt.description}`);
            extractedBodyText = parts.join('\n\n');
            dbg(`result: OK, title="${yt.title.slice(0, 60)}"`);
          } else {
            extractedBodyText = '⚠️ Could not extract YouTube metadata — YouTube may have changed their page format.';
            dbg('result: FAILED');
          }
        } else {
          const article = extractContent(html, sourceUrl);
          extractedTitle = (article?.title || sourceTitle || '').trim();

          if (article) {
            const meta: string[] = [];
            if (article.byline) meta.push(`By: ${article.byline}`);
            if (article.siteName) meta.push(`Site: ${article.siteName}`);
            if (article.publishedTime) meta.push(`Published: ${article.publishedTime}`);

            const parts: string[] = [];
            parts.push(`# ${extractedTitle}`);
            if (meta.length) parts.push(meta.join(' · '));
            if (article.excerpt) parts.push(`> ${article.excerpt}`);
            if (article.textContent) parts.push(article.textContent);
            extractedBodyText = parts.join('\n\n');
          }
        }
      } catch (e) {
        dbg(`decode error: ${e}`);
      }
    } else {
      extractedTitle = sourceTitle;
    }

    fieldWhat.value = sourceUrl;

    if (extractedBodyText) {
      contentPreviewText.textContent = extractedBodyText;
      contentPreview.style.display = 'block';
    }

    loadingIndicator?.remove();
    fieldWhat.focus();
  }

  btnSave.addEventListener('click', () => {
    const what = fieldWhat.value.trim();
    const who = fieldWho.value.trim();
    const why = fieldWhy.value.trim();

    // In bookmarklet mode use the article title for the slug; otherwise use first line of what
    const slugSource = isBookmarklet && extractedTitle ? extractedTitle : what.split('\n')[0] ?? 'capture';
    const slug = makeReadableSlug(slugSource) || 'capture';

    let filename: string;
    if (config.canvas) {
      // Canvas filenames: no timestamp, just the slug
      filename = `${slug}.canvas`;
    } else {
      const ts = makeHumanTimestamp();
      filename = `${ts} ${slug}.md`;
    }

    // For a link node, prefer the bookmarklet-captured URL then scan the what field
    const canvasUrl = extractedUrl || extractUrl(what);

    // Resolve boolean prop values from checkboxes; text props pass through unchanged
    const resolvedProps = config.props.map(prop => {
      if (prop.type !== 'boolean') return prop;
      const cb = boolPropsSection.querySelector<HTMLInputElement>(`[data-key="${escProp(prop.k)}"]`);
      return { ...prop, v: cb?.checked ? 'true' : 'false' };
    });

    let content: string;
    if (config.canvas) {
      // Always produce a canvas file; node type depends on whether we have a URL.
      // Text nodes don't render frontmatter, so use plain markdown for them.
      const noteText = buildCanvasNoteText({
        what,
        who,
        why,
        bodyText: isBookmarklet ? extractedBodyText : '',
        url: extractedUrl,
      });
      content = buildCanvasContent(canvasUrl, noteText);
    } else {
      content = buildNoteContent({
        what,
        who,
        why,
        props: resolvedProps,
        bodyText: isBookmarklet ? extractedBodyText : '',
        url: extractedUrl,
      });
    }

    const uri = buildObsidianUri({
      vault: config.vault,
      folder: config.folder,
      filename,
      content,
    });

    window.parent.postMessage({ type: 'obsidianUri', url: uri }, '*');
    window.location.href = uri;

    // The obsidian:// scheme doesn't navigate away from the page, so reset the
    // form so it's blank if the user returns (especially from the home screen).
    setTimeout(resetForm, 500);

    if (isBookmarklet) {
      // Give the URI a moment to register before signaling close
      setTimeout(() => {
        window.parent.postMessage({ type: 'close' }, '*');
      }, 300);
    }
  });

}

/** Detect iOS/PWA standalone mode (launched from home screen). */
function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

/** Escape a string for use in an HTML attribute value. */
function escProp(str: string): string {
  return str.replace(/"/g, '&quot;');
}

/** Decode a URI component, ignoring errors (returns original string on failure). */
function safeDecodeUri(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Return the first http(s) URL found in a string, or empty string. */
function extractUrl(text: string): string {
  return text.match(/https?:\/\/\S+/)?.[0] ?? '';
}

/**
 * Draw a 180×180 icon on an offscreen canvas and set it as the apple-touch-icon.
 * Uses the emoji if provided, otherwise the first character of the name.
 * iOS reads this link element at "Add to Home Screen" time.
 */
function generateHomeIcon(emoji: string, name: string): void {
  const char = emoji || name.charAt(0) || '○';
  const size = 180;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Background — match the app accent colour
  ctx.fillStyle = '#7c6af5';
  ctx.fillRect(0, 0, size, size);

  // Character/emoji centred
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = emoji ? '110px sans-serif' : 'bold 96px sans-serif';
  ctx.fillText(char, size / 2, size / 2);

  let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    document.head.appendChild(link);
  }
  link.href = canvas.toDataURL('image/png');
}
