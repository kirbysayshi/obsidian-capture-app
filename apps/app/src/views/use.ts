import { decodeInstances, decodeScraperConfig, type Config } from '../lib/config.js';
import { scrapeUrl, extractAllUrls } from '../lib/scraper.js';
import {
  buildObsidianUri,
  buildNoteContent,
  buildCanvasContent,
  buildCanvasNoteText,
  makeReadableSlug,
  makeHumanTimestamp,
} from '../lib/obsidian.js';
import { extractContent, extractYouTubeContent, extractFromYtData, isYouTubeVideo } from '../lib/content.js';

type ScrapeStatus = 'pending' | 'loading' | 'done' | 'error';
interface ScrapeEntry {
  id: string;
  url: string;
  status: ScrapeStatus;
  bodyText: string;
  title: string;
  errorMsg: string;
  excluded: boolean;
}

export function renderUse(root: HTMLElement, params: URLSearchParams): void {
  const instances = decodeInstances(params) ?? [];
  if (instances.length === 0) return;

  const isBookmarklet = params.get('mode') === 'bm';
  const scraperConfig = decodeScraperConfig(params);
  const hasScraperConfig = !!scraperConfig.serviceUrl;

  // ── Content extraction (bookmarklet / Shortcuts path) ─────────────────────
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

  // ── Apply title/icon ───────────────────────────────────────────────────────
  const firstInstance = instances[0];
  const globalName = params.get('sn') ?? '';
  const globalEmoji = params.get('se') ?? '';
  applyPageMeta({
    ...firstInstance,
    name: globalName || firstInstance.name,
    emoji: globalEmoji || firstInstance.emoji,
  });

  // ── Render skeleton ────────────────────────────────────────────────────────
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

        ${!isBookmarklet && hasScraperConfig ? '<div id="scrapeList" class="scrape-list"></div>' : ''}

        <div class="btn-row">
          <button class="btn-save" id="btnSave">Save to Obsidian</button>
          <button class="btn-cancel secondary" id="btnCancel">Cancel</button>
        </div>

        ${isBookmarklet ? `
        <div id="contentPreview" class="content-preview" style="display:none">
          <label>Clipped content</label>
          <pre id="contentPreviewText"></pre>
        </div>` : ''}

        <details id="debugDetails" class="debug-details">
          <summary>Debug <button id="btnCopyDebug" class="debug-copy-btn" type="button">Copy</button></summary>
          <pre id="debugLog"></pre>
        </details>
      </div>
    </div>
  `;

  // ── Picker interaction ─────────────────────────────────────────────────────
  const instancePicker = root.querySelector<HTMLElement>('#instancePicker')!;
  const captureForm = root.querySelector<HTMLElement>('#captureForm')!;

  let activeConfig: Config = firstInstance;
  const isMultiInstance = instances.length > 1;

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

  // ── Scrape entry state (non-bookmarklet) ───────────────────────────────────
  let scrapeEntries: ScrapeEntry[] = [];
  let scrapeTimer: ReturnType<typeof setTimeout> | null = null;

  function reconcileScrapeEntries(urls: string[]): void {
    const existingMap = new Map(scrapeEntries.map(e => [e.url, e]));
    scrapeEntries = urls.map(url => {
      if (existingMap.has(url)) return existingMap.get(url)!;
      return {
        id: `entry-${Math.random().toString(36).slice(2)}`,
        url,
        status: 'pending',
        bodyText: '',
        title: '',
        errorMsg: '',
        excluded: false,
      };
    });
    renderScrapeList();
  }

  async function doScrapeEntry(entry: ScrapeEntry): Promise<void> {
    entry.status = 'loading';
    renderScrapeList();
    try {
      const result = await scrapeUrl(scraperConfig.serviceUrl, scraperConfig.secret, entry.url);
      const diag: string[] = [];
      if (isYouTubeVideo(result.url) || isYouTubeVideo(entry.url)) {
        const yt = extractYouTubeContent(result.html, diag);
        entry.title = yt?.title || '';
        if (yt) {
          const parts: string[] = [];
          parts.push(`# ${yt.title}`);
          const channelLine = [yt.channel, yt.subs].filter(Boolean).join(' · ');
          if (channelLine) parts.push(`**Channel:** ${channelLine}`);
          if (yt.description) parts.push(`**Description:**\n\n${yt.description}`);
          entry.bodyText = parts.join('\n\n');
        } else {
          entry.bodyText = '⚠️ Could not extract YouTube metadata.';
        }
      } else {
        const article = extractContent(result.html, result.url);
        entry.title = article?.title?.trim() || '';
        if (article) {
          const meta: string[] = [];
          if (article.byline) meta.push(`By: ${article.byline}`);
          if (article.siteName) meta.push(`Site: ${article.siteName}`);
          if (article.publishedTime) meta.push(`Published: ${article.publishedTime}`);
          const parts: string[] = [];
          parts.push(`# ${entry.title}`);
          if (meta.length) parts.push(meta.join(' · '));
          if (article.excerpt) parts.push(`> ${article.excerpt}`);
          if (article.textContent) parts.push(article.textContent);
          entry.bodyText = parts.join('\n\n');
        } else {
          const yt = extractYouTubeContent(result.html, diag);
          if (yt) {
            entry.title = yt.title;
            const parts: string[] = [];
            parts.push(`# ${yt.title}`);
            const channelLine = [yt.channel, yt.subs].filter(Boolean).join(' · ');
            if (channelLine) parts.push(`**Channel:** ${channelLine}`);
            if (yt.description) parts.push(`**Description:**\n\n${yt.description}`);
            entry.bodyText = parts.join('\n\n');
          }
        }
      }
      entry.url = result.url;
      entry.status = 'done';
    } catch (err) {
      entry.status = 'error';
      entry.errorMsg = err instanceof Error ? err.message : String(err);
    }
    renderScrapeList();
  }

  function renderScrapeList(): void {
    const list = root.querySelector<HTMLElement>('#scrapeList');
    if (!list) return;

    if (scrapeEntries.length === 0) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = scrapeEntries.map(entry => {
      const urlDisplay = escHtml(entry.url.replace(/^https?:\/\//, '').slice(0, 80));

      let statusIcon = '';
      let statusClass = '';
      if (entry.status === 'pending') {
        statusIcon = `<span class="scrape-entry-status-icon scrape-entry-status--pending">○</span>`;
        statusClass = 'scrape-entry--pending';
      } else if (entry.status === 'loading') {
        statusIcon = `<span class="scrape-entry-status-icon scrape-entry-status--loading"></span>`;
        statusClass = 'scrape-entry--loading';
      } else if (entry.status === 'done') {
        statusIcon = `<span class="scrape-entry-status-icon scrape-entry-status--done">✓</span>`;
        statusClass = 'scrape-entry--done';
      } else {
        statusIcon = `<span class="scrape-entry-status-icon scrape-entry-status--error">⚠</span>`;
        statusClass = 'scrape-entry--error';
      }

      const excludeBtn = entry.excluded
        ? `<button class="btn-exclude-entry" data-action="include" data-id="${entry.id}" title="Re-include">↩</button>`
        : `<button class="btn-exclude-entry" data-action="exclude" data-id="${entry.id}" title="Exclude">✕</button>`;

      const fetchBtn = entry.status === 'pending'
        ? `<button class="btn-scrape-entry" data-id="${entry.id}" type="button">Fetch</button>`
        : entry.status === 'error'
          ? `<button class="btn-retry-entry" data-id="${entry.id}" type="button">Retry</button>`
          : '';

      const preview = entry.status === 'done' && !entry.excluded && entry.bodyText
        ? `<details class="scrape-entry-preview">
            <summary>Clipped content</summary>
            <pre>${escHtml(entry.bodyText.slice(0, 500))}${entry.bodyText.length > 500 ? '…' : ''}</pre>
          </details>`
        : '';

      const errorMsg = entry.status === 'error'
        ? `<div class="scrape-entry-error">${escHtml(entry.errorMsg)}</div>`
        : '';

      const entryClass = ['scrape-entry', statusClass, entry.excluded ? 'scrape-entry--excluded' : ''].filter(Boolean).join(' ');
      const isClickable = entry.status === 'pending' && !entry.excluded;
      const headerClass = isClickable ? 'scrape-entry-header scrape-entry-header--clickable' : 'scrape-entry-header';

      return `<div class="${entryClass}" data-id="${entry.id}">
        <div class="${headerClass}" data-fetch="${isClickable ? entry.id : ''}">
          ${statusIcon}
          <span class="scrape-entry-url" title="${escHtml(entry.url)}">${urlDisplay}</span>
          ${fetchBtn}
          ${excludeBtn}
        </div>
        ${errorMsg}
        ${preview}
      </div>`;
    }).join('');

    list.querySelectorAll<HTMLButtonElement>('.btn-scrape-entry, .btn-retry-entry').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const entry = scrapeEntries.find(e => e.id === btn.dataset.id);
        if (entry && entry.status !== 'loading') void doScrapeEntry(entry);
      });
    });

    list.querySelectorAll<HTMLButtonElement>('.btn-exclude-entry').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const entry = scrapeEntries.find(e => e.id === btn.dataset.id);
        if (entry) {
          entry.excluded = btn.dataset.action === 'exclude';
          renderScrapeList();
        }
      });
    });

    list.querySelectorAll<HTMLElement>('.scrape-entry-header--clickable').forEach(header => {
      header.addEventListener('click', () => {
        const entry = scrapeEntries.find(e => e.id === header.dataset.fetch);
        if (entry && entry.status === 'pending') void doScrapeEntry(entry);
      });
    });
  }

  // ── showForm: wire up form for a selected config ───────────────────────────
  function showForm(config: Config): void {
    const fieldWhat = root.querySelector<HTMLTextAreaElement>('#fieldWhat')!;
    const fieldWho = root.querySelector<HTMLInputElement>('#fieldWho')!;
    const fieldWhy = root.querySelector<HTMLTextAreaElement>('#fieldWhy')!;
    const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;
    const loadingIndicator = root.querySelector<HTMLElement>('#loadingIndicator');
    const contentPreview = root.querySelector<HTMLElement>('#contentPreview');
    const contentPreviewText = root.querySelector<HTMLElement>('#contentPreviewText');
    const btnCancel = root.querySelector<HTMLButtonElement>('#btnCancel')!;
    const configureLink = root.querySelector<HTMLAnchorElement>('#configureLink');
    const boolPropsSection = root.querySelector<HTMLElement>('#boolPropsSection')!;
    const debugLog = root.querySelector<HTMLElement>('#debugLog')!;
    const btnCopyDebug = root.querySelector<HTMLButtonElement>('#btnCopyDebug')!;
    const vaultInfo = root.querySelector<HTMLElement>('#vaultInfo')!;
    const canvasBadge = root.querySelector<HTMLElement>('#canvasBadge')!;
    const captureTitle = root.querySelector<HTMLElement>('#captureTitle')!;

    const titleText = config.emoji ? `${config.emoji} ${config.name || 'Capture'}` : (config.name || 'Capture');
    captureTitle.textContent = titleText;
    vaultInfo.innerHTML = `→ ${escHtml(config.vault)}${config.folder ? `<br><span class="vault-folder">${escHtml(config.folder)}</span>` : ''}`;
    canvasBadge.style.display = config.canvas ? '' : 'none';

    if (configureLink) {
      const configureParams = new URLSearchParams(params);
      configureParams.delete('mode');
      configureParams.set('mode', 'configure');
      configureLink.href = `${window.location.pathname}?${configureParams}`;
    }

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
      scrapeEntries = [];
      renderScrapeList();
      if (contentPreview) contentPreview.style.display = 'none';
      if (contentPreviewText) contentPreviewText.textContent = '';
      for (const prop of booleanProps) {
        const cb = boolPropsSection.querySelector<HTMLInputElement>(`[data-key="${escProp(prop.k)}"]`);
        if (cb) cb.checked = prop.v === 'true';
      }
    }

    btnCancel.addEventListener('click', () => {
      if (isMultiInstance) {
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

    function populateFromExtraction(): void {
      if (isBookmarklet) {
        fieldWhat.value = extractedUrl;
        if (extractedBodyText && contentPreviewText && contentPreview) {
          contentPreviewText.textContent = extractedBodyText;
          contentPreview.style.display = 'block';
        }
        loadingIndicator?.remove();
        fieldWhat.focus();
      }
    }

    if (isBookmarklet) {
      onExtractionDone(populateFromExtraction);
    }

    // ── Scraper input handler (non-bookmarklet) ───────────────────────────────
    if (!isBookmarklet && hasScraperConfig) {
      fieldWhat.addEventListener('input', () => {
        const urls = extractAllUrls(fieldWhat.value);
        reconcileScrapeEntries(urls);
        if (scrapeTimer) clearTimeout(scrapeTimer);
        if (urls.length === 1 && scrapeEntries[0]?.status === 'pending') {
          scrapeTimer = setTimeout(() => void doScrapeEntry(scrapeEntries[0]), 600);
        }
      });
    }

    // ── Save handler ───────────────────────────────────────────────────────────
    btnSave.addEventListener('click', () => {
      const what = fieldWhat.value.trim();
      const who = fieldWho.value.trim();
      const why = fieldWhy.value.trim();

      let slugSource: string;
      let bodyText: string;
      let primaryUrl: string;

      if (isBookmarklet) {
        slugSource = extractedTitle || (what.split('\n')[0] ?? 'capture');
        bodyText = extractedBodyText;
        primaryUrl = extractedUrl;
      } else if (hasScraperConfig) {
        const doneEntries = scrapeEntries.filter(e => e.status === 'done' && !e.excluded);
        const firstTitle = doneEntries[0]?.title || '';
        slugSource = firstTitle || (what.split('\n')[0] ?? 'capture');

        let aggregatedBody = doneEntries.map(e => e.bodyText).filter(Boolean).join('\n\n---\n\n');
        if (doneEntries.length === 1) {
          primaryUrl = doneEntries[0].url;
        } else if (doneEntries.length > 1) {
          const sources = doneEntries.map(e => `- ${e.url}`).join('\n');
          if (aggregatedBody) aggregatedBody += '\n\n';
          aggregatedBody += `Sources:\n${sources}`;
          primaryUrl = '';
        } else {
          primaryUrl = '';
        }
        bodyText = aggregatedBody;
      } else {
        slugSource = what.split('\n')[0] ?? 'capture';
        bodyText = '';
        primaryUrl = '';
      }

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
          bodyText,
          url: primaryUrl,
        });
        let canvasUrls: string[];
        if (hasScraperConfig && scrapeEntries.length > 0) {
          canvasUrls = scrapeEntries.filter(e => !e.excluded).map(e => e.url);
        } else {
          canvasUrls = extractAllUrls([what, who, why].join('\n'));
        }
        if (primaryUrl && !canvasUrls.includes(primaryUrl)) {
          canvasUrls = [primaryUrl, ...canvasUrls];
        }
        content = buildCanvasContent(noteText, canvasUrls);
      } else {
        content = buildNoteContent({
          what,
          who,
          why,
          props: resolvedProps,
          bodyText,
          url: primaryUrl,
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
