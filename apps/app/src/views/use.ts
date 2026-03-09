import { decodeInstances, decodeScraperConfig, type Config } from '../lib/config.js';
import { scrapeUrl, extractFirstUrl } from '../lib/scraper.js';
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
  const instances = decodeInstances(params) ?? [];
  if (instances.length === 0) return;

  const isBookmarklet = params.get('mode') === 'bm';
  const scraperConfig = decodeScraperConfig(params);
  const hasScraperConfig = !!scraperConfig.serviceUrl;

  // ── Content extraction (bookmarklet / Shortcuts path) ─────────────────────
  // Start extraction immediately so it runs in parallel with any picker interaction.

  let extractedUrl = '';
  let extractedBodyText = '';
  let extractedTitle = '';
  let extractionDone = false;
  let extractionCallbacks: Array<() => void> = [];

  function onExtractionDone(cb: () => void): void {
    if (extractionDone) { cb(); return; }
    extractionCallbacks.push(cb);
  }

  function finishExtraction(): void {
    extractionDone = true;
    extractionCallbacks.forEach(cb => cb());
    extractionCallbacks = [];
  }

  const debugLines: string[] = [];
  function dbg(...lines: string[]): void {
    debugLines.push(...lines);
  }

  if (isBookmarklet) {
    const hashData = location.hash.slice(1);
    const sourceUrl = safeDecodeUri(params.get('url') ?? '');
    const sourceTitle = safeDecodeUri(params.get('title') ?? '');

    extractedUrl = sourceUrl;
    dbg(`url: ${sourceUrl}`, `hash.length: ${hashData.length}`, `isYT: ${isYouTubeVideo(sourceUrl)}`);

    if (hashData) {
      try {
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(hashData), c => c.charCodeAt(0))
        );
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
    finishExtraction();
  } else {
    finishExtraction();
  }

  // ── Apply title/icon — prefer global sn/se, fall back to first instance ──
  const firstInstance = instances[0];
  const globalName = params.get('sn') ?? '';
  const globalEmoji = params.get('se') ?? '';
  applyPageMeta({
    ...firstInstance,
    name: globalName || firstInstance.name,
    emoji: globalEmoji || firstInstance.emoji,
  });

  // ── Render skeleton ───────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="use-view">
      <div id="instancePicker" class="instance-picker" style="${instances.length === 1 ? 'display:none' : ''}">
        <h2>Where do you want to save?</h2>
        ${instances.map((inst, i) => `
          <button class="instance-option" data-index="${i}">
            <span class="instance-option-icon">${escHtml(inst.emoji || '📎')}</span>
            <span class="instance-option-text">
              <span class="instance-option-name">${escHtml(inst.name || 'Capture to Obsidian')}</span>
              <span class="instance-option-sub">${escHtml(inst.vault)}${inst.folder ? ' / ' + inst.folder : ''}</span>
            </span>
          </button>
        `).join('')}
        <div class="picker-footer">
          <a class="configure-link" id="pickerConfigureLink" href="#">Edit configuration</a>
          <button class="btn-cancel secondary" id="btnPickerCancel">Cancel</button>
        </div>
      </div>

      <div id="captureForm" style="${instances.length > 1 ? 'display:none' : ''}">
        <h1>
          <span id="captureTitle">Capture</span>
          <span class="canvas-badge" id="canvasBadge" style="display:none">Canvas</span>
        </h1>
        <p class="vault-info" id="vaultInfo"></p>
        ${instances.length === 1 ? '<a class="configure-link" id="configureLink" href="#">Edit configuration</a>' : ''}

        <div class="field">
          <div class="field-label-row">
            <label for="fieldWhat">What</label>
            ${isBookmarklet ? '<span class="loading-indicator" id="loadingIndicator">Extracting page content</span>' : ''}
            ${!isBookmarklet && hasScraperConfig ? '<span class="loading-indicator" id="loadingIndicator" style="visibility:hidden"></span>' : ''}
            ${!isBookmarklet && hasScraperConfig ? '<button class="btn-fetch" id="btnFetch" type="button" style="visibility:hidden">Fetch</button>' : ''}
          </div>
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
    </div>
  `;

  // ── Picker interaction ────────────────────────────────────────────────────
  const instancePicker = root.querySelector<HTMLElement>('#instancePicker')!;
  const captureForm = root.querySelector<HTMLElement>('#captureForm')!;

  let activeConfig: Config = firstInstance;
  const isMultiInstance = instances.length > 1;

  // ── Picker cancel + configure link ───────────────────────────────────────
  if (isMultiInstance) {
    const configureParams = new URLSearchParams(params);
    configureParams.delete('mode');
    configureParams.set('mode', 'configure');
    const configureHref = `${window.location.pathname}?${configureParams}`;

    const pickerConfigureLink = root.querySelector<HTMLAnchorElement>('#pickerConfigureLink')!;
    pickerConfigureLink.href = configureHref;

    root.querySelector<HTMLButtonElement>('#btnPickerCancel')!.addEventListener('click', () => {
      if (isBookmarklet) {
        window.parent.postMessage({ type: 'close' }, '*');
      } else {
        window.history.back();
      }
    });
  }

  if (instances.length === 1) {
    // Skip picker — go straight to form
    showForm(firstInstance);
  } else {
    instancePicker.querySelectorAll<HTMLButtonElement>('.instance-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index ?? '0', 10);
        activeConfig = instances[idx];
        applyPageMeta(activeConfig);
        instancePicker.style.display = 'none';
        captureForm.style.display = '';
        showForm(activeConfig);
      });
    });
  }

  // ── showForm: wire up form for a selected config ──────────────────────────
  function showForm(config: Config): void {
    const fieldWhat = root.querySelector<HTMLTextAreaElement>('#fieldWhat')!;
    const fieldWho = root.querySelector<HTMLInputElement>('#fieldWho')!;
    const fieldWhy = root.querySelector<HTMLTextAreaElement>('#fieldWhy')!;
    const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;
    const loadingIndicator = root.querySelector<HTMLElement>('#loadingIndicator');
    const contentPreview = root.querySelector<HTMLElement>('#contentPreview')!;
    const contentPreviewText = root.querySelector<HTMLElement>('#contentPreviewText')!;
    const btnCancel = root.querySelector<HTMLButtonElement>('#btnCancel')!;
    const configureLink = root.querySelector<HTMLAnchorElement>('#configureLink');
    const boolPropsSection = root.querySelector<HTMLElement>('#boolPropsSection')!;
    const debugLog = root.querySelector<HTMLElement>('#debugLog')!;
    const btnCopyDebug = root.querySelector<HTMLButtonElement>('#btnCopyDebug')!;
    const vaultInfo = root.querySelector<HTMLElement>('#vaultInfo')!;
    const canvasBadge = root.querySelector<HTMLElement>('#canvasBadge')!;
    const captureTitle = root.querySelector<HTMLElement>('#captureTitle')!;

    // Apply config to form header
    const titleText = config.emoji ? `${config.emoji} ${config.name || 'Capture'}` : (config.name || 'Capture');
    captureTitle.textContent = titleText;
    vaultInfo.innerHTML = `→ ${escHtml(config.vault)}${config.folder ? `<br><span class="vault-folder">${escHtml(config.folder)}</span>` : ''}`;
    canvasBadge.style.display = config.canvas ? '' : 'none';

    // Build configure URL (single-instance only — multi-instance uses picker's link)
    if (configureLink) {
      const configureParams = new URLSearchParams(params);
      configureParams.delete('mode');
      configureParams.set('mode', 'configure');
      configureLink.href = `${window.location.pathname}?${configureParams}`;
    }

    // Flush buffered debug lines
    debugLog.textContent = debugLines.join('\n') + (debugLines.length ? '\n' : '');

    btnCopyDebug.addEventListener('click', (e) => {
      e.preventDefault();
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
    boolPropsSection.innerHTML = '';
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

    function resetForm(): void {
      fieldWhat.value = '';
      fieldWho.value = '';
      fieldWhy.value = '';
      contentPreview.style.display = 'none';
      contentPreviewText.textContent = '';
      for (const prop of booleanProps) {
        const cb = boolPropsSection.querySelector<HTMLInputElement>(`[data-key="${escProp(prop.k)}"]`);
        if (cb) cb.checked = prop.v === 'true';
      }
    }

    btnCancel.addEventListener('click', () => {
      if (isMultiInstance) {
        // Return to the picker
        captureForm.style.display = 'none';
        instancePicker.style.display = '';
      } else if (isBookmarklet) {
        window.parent.postMessage({ type: 'close' }, '*');
      } else if (isStandalone()) {
        resetForm();
      } else {
        window.history.back();
      }
    });

    // Populate form once extraction is done
    function populateFromExtraction(): void {
      if (isBookmarklet) {
        fieldWhat.value = extractedUrl;
        if (extractedBodyText) {
          contentPreviewText.textContent = extractedBodyText;
          contentPreview.style.display = 'block';
        }
        loadingIndicator?.remove();
        fieldWhat.focus();
      } else if (hasScraperConfig) {
        if (extractedBodyText) {
          contentPreviewText.textContent = extractedBodyText;
          contentPreview.style.display = 'block';
        }
      }
    }

    if (isBookmarklet) {
      onExtractionDone(populateFromExtraction);
    }

    // ── Scraper auto-fetch (non-bookmarklet path) ─────────────────────────
    let scrapeTimer: ReturnType<typeof setTimeout> | null = null;
    const btnFetch = root.querySelector<HTMLButtonElement>('#btnFetch');

    async function doScrape(url: string): Promise<void> {
      if (loadingIndicator) {
        loadingIndicator.textContent = 'Fetching page content…';
        loadingIndicator.style.visibility = 'visible';
      }
      contentPreview.style.display = 'none';
      try {
        const result = await scrapeUrl(scraperConfig.serviceUrl, scraperConfig.secret, url);
        const diag: string[] = [];
        if (isYouTubeVideo(result.url) || isYouTubeVideo(url)) {
          const yt = extractYouTubeContent(result.html, diag);
          extractedTitle = yt?.title || '';
          if (yt) {
            const parts: string[] = [];
            parts.push(`# ${yt.title}`);
            const channelLine = [yt.channel, yt.subs].filter(Boolean).join(' · ');
            if (channelLine) parts.push(`**Channel:** ${channelLine}`);
            if (yt.description) parts.push(`**Description:**\n\n${yt.description}`);
            extractedBodyText = parts.join('\n\n');
          } else {
            extractedBodyText = '⚠️ Could not extract YouTube metadata.';
          }
        } else {
          const article = extractContent(result.html, result.url);
          extractedTitle = article?.title?.trim() || '';
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
          } else {
            // Readability failed — try YouTube extraction as fallback (HTML may contain ytInitialData)
            const yt = extractYouTubeContent(result.html, diag);
            if (yt) {
              extractedTitle = yt.title;
              const parts: string[] = [];
              parts.push(`# ${yt.title}`);
              const channelLine = [yt.channel, yt.subs].filter(Boolean).join(' · ');
              if (channelLine) parts.push(`**Channel:** ${channelLine}`);
              if (yt.description) parts.push(`**Description:**\n\n${yt.description}`);
              extractedBodyText = parts.join('\n\n');
            }
          }
        }
        extractedUrl = result.url;
        if (loadingIndicator) loadingIndicator.style.visibility = 'hidden';
        populateFromExtraction();
      } catch (err) {
        if (loadingIndicator) {
          loadingIndicator.textContent = `⚠️ Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    if (!isBookmarklet && hasScraperConfig && fieldWhat && btnFetch) {
      fieldWhat.addEventListener('input', () => {
        const url = extractFirstUrl(fieldWhat.value);
        if (!url) { btnFetch.style.visibility = 'hidden'; return; }
        btnFetch.style.visibility = 'visible';
        if (scrapeTimer) clearTimeout(scrapeTimer);
        scrapeTimer = setTimeout(() => doScrape(url), 600);
      });
      btnFetch.addEventListener('click', () => {
        const url = extractFirstUrl(fieldWhat.value);
        if (url) doScrape(url);
      });
    }

    btnSave.addEventListener('click', () => {
      const what = fieldWhat.value.trim();
      const who = fieldWho.value.trim();
      const why = fieldWhy.value.trim();

      const slugSource = (isBookmarklet || hasScraperConfig) && extractedTitle ? extractedTitle : what.split('\n')[0] ?? 'capture';
      const slug = makeReadableSlug(slugSource) || 'capture';

      let filename: string;
      if (config.canvas) {
        filename = `${slug}.canvas`;
      } else {
        const ts = makeHumanTimestamp();
        filename = `${ts} ${slug}.md`;
      }

      const resolvedProps = config.props.map(prop => {
        if (prop.type !== 'boolean') return prop;
        const cb = boolPropsSection.querySelector<HTMLInputElement>(`[data-key="${escProp(prop.k)}"]`);
        return { ...prop, v: cb?.checked ? 'true' : 'false' };
      });

      let content: string;
      if (config.canvas) {
        const noteText = buildCanvasNoteText({
          what,
          who,
          why,
          bodyText: (isBookmarklet || hasScraperConfig) ? extractedBodyText : '',
          url: extractedUrl,
        });
        const allUrls: string[] = extractedUrl ? [extractedUrl] : [];
        for (const u of extractAllUrls(what, who, why)) {
          if (!allUrls.includes(u)) allUrls.push(u);
        }
        content = buildCanvasContent(noteText, allUrls);
      } else {
        content = buildNoteContent({
          what,
          who,
          why,
          props: resolvedProps,
          bodyText: (isBookmarklet || hasScraperConfig) ? extractedBodyText : '',
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

      setTimeout(resetForm, 500);

      if (isBookmarklet) {
        setTimeout(() => {
          window.parent.postMessage({ type: 'close' }, '*');
        }, 300);
      }
    });
  }
}

function applyPageMeta(config: Config): void {
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
  generateHomeIcon(config.emoji, config.name);
}

/** Detect iOS/PWA standalone mode (launched from home screen). */
function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

function escProp(str: string): string {
  return str.replace(/"/g, '&quot;');
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeDecodeUri(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function extractAllUrls(...texts: string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(/https?:\/\/\S+/g)) {
      const url = m[0].replace(/[.,;:!?)]+$/, ''); // strip trailing punctuation
      if (!seen.has(url)) { seen.add(url); urls.push(url); }
    }
  }
  return urls;
}

function generateHomeIcon(emoji: string, name: string): void {
  const char = emoji || name.charAt(0) || '○';
  const size = 180;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#7c6af5';
  ctx.fillRect(0, 0, size, size);

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
