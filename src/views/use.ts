import { decodeConfig } from '../lib/config.js';
import {
  buildObsidianUri,
  buildNoteContent,
  buildCanvasContent,
  buildCanvasNoteText,
  makeSlug,
  makeTimestamp,
} from '../lib/obsidian.js';
import { extractContent, extractYouTubeContent, isYouTubeVideo } from '../lib/content.js';

interface PageContentMessage {
  type: 'pageContent';
  html: string;
  url: string;
  title: string;
}

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

  root.innerHTML = `
    <div class="use-view">
      <h1>
        Capture
        ${config.canvas ? '<span class="canvas-badge">Canvas</span>' : ''}
      </h1>
      <p class="vault-info">→ ${config.vault}${config.folder ? ' / ' + config.folder : ''}</p>

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

      <div class="btn-row">
        <button class="btn-save" id="btnSave">Save to Obsidian</button>
        <button class="btn-cancel secondary" id="btnCancel">Cancel</button>
      </div>

      <div id="contentPreview" class="content-preview" style="display:none">
        <label>Clipped content</label>
        <pre id="contentPreviewText"></pre>
      </div>
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

  btnCancel.addEventListener('click', () => {
    if (isBookmarklet) {
      window.parent.postMessage({ type: 'close' }, '*');
    } else {
      window.history.back();
    }
  });

  let extractedUrl = '';
  let extractedBodyText = '';  // title + body combined, goes into note body
  let extractedTitle = '';     // used for filename slug

  if (isBookmarklet) {
    // Request page content from the parent bookmarklet overlay
    window.parent.postMessage({ type: 'requestContent' }, '*');

    function handleMessage(e: MessageEvent): void {
      const data = e.data as PageContentMessage | undefined;
      if (!data || data.type !== 'pageContent') return;
      window.removeEventListener('message', handleMessage);

      extractedUrl = data.url ?? '';

      if (isYouTubeVideo(data.url)) {
        const yt = extractYouTubeContent(data.html);
        extractedTitle = yt?.title || data.title || '';

        if (yt) {
          const parts: string[] = [];
          parts.push(`# ${yt.title}`);
          const channelLine = [yt.channel, yt.subs].filter(Boolean).join(' · ');
          if (channelLine) parts.push(`**Channel:** ${channelLine}`);
          if (yt.description) parts.push(`**Description:**\n\n${yt.description}`);
          extractedBodyText = parts.join('\n\n');
        }
      } else {
        const article = extractContent(data.html, data.url);
        extractedTitle = (article?.title || data.title || '').trim();

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

      // Pre-fill what with just the URL — that's all that goes in the frontmatter
      fieldWhat.value = data.url ?? '';

      if (extractedBodyText) {
        contentPreviewText.textContent = extractedBodyText;
        contentPreview.style.display = 'block';
      }

      loadingIndicator?.remove();
      fieldWhat.focus();
    }

    window.addEventListener('message', handleMessage);
  }

  btnSave.addEventListener('click', () => {
    const what = fieldWhat.value.trim();
    const who = fieldWho.value.trim();
    const why = fieldWhy.value.trim();

    // In bookmarklet mode use the article title for the slug; otherwise use first line of what
    const slugSource = isBookmarklet && extractedTitle ? extractedTitle : what.split('\n')[0] ?? 'capture';
    const slug = makeSlug(slugSource) || 'capture';
    const ts = makeTimestamp();

    const ext = config.canvas ? '.canvas' : '.md';
    const filename = `${ts}-${slug}${ext}`;

    // For a link node, prefer the bookmarklet-captured URL then scan the what field
    const canvasUrl = extractedUrl || extractUrl(what);

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
        props: config.props,
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

    window.location.href = uri;

    // The obsidian:// scheme doesn't navigate away from the page, so reset the
    // form so it's blank if the user returns (especially from the home screen).
    setTimeout(() => {
      fieldWhat.value = '';
      fieldWho.value = '';
      fieldWhy.value = '';
      extractedUrl = '';
      extractedBodyText = '';
      extractedTitle = '';
      contentPreview.style.display = 'none';
      contentPreviewText.textContent = '';
    }, 500);

    if (isBookmarklet) {
      // Give the URI a moment to register before signaling close
      setTimeout(() => {
        window.parent.postMessage({ type: 'close' }, '*');
      }, 300);
    }
  });

  checkForUpdate(root);
}

/**
 * Fetch ./version.json and compare to the build-time constant.
 * If they differ, prepend a refresh banner to root (at most once).
 * Also re-checks whenever the page becomes visible again.
 */
function checkForUpdate(root: HTMLElement): void {
  if (import.meta.env.DEV) return;

  async function check(): Promise<void> {
    // Skip if the banner is already showing
    if (root.querySelector('.update-banner')) return;
    try {
      // Query param busts any aggressive WebKit cache that ignores no-cache headers
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) return;
      const { version } = await res.json() as { version: string };
      if (version === __APP_VERSION__) return;

      const banner = document.createElement('div');
      banner.className = 'update-banner';
      banner.innerHTML = `<span>A new version is available.</span><button class="btn-refresh">Refresh</button>`;
      banner.querySelector('.btn-refresh')!.addEventListener('click', () => location.reload());
      root.prepend(banner);
    } catch {
      // Network unavailable — silently ignore
    }
  }

  check();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** Return the first http(s) URL found in a string, or empty string. */
function extractUrl(text: string): string {
  return text.match(/https?:\/\/\S+/)?.[0] ?? '';
}
