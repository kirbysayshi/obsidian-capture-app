import { encodeConfig, decodeConfig, type Prop } from '../lib/config.js';
import { generateBookmarklet } from '../lib/bookmarklet.js';

export function renderConfigure(root: HTMLElement, prefill?: URLSearchParams | null): void {
  root.innerHTML = `
    <div class="configure-view">
      <h1>Obsidian Capture</h1>
      <p class="subtitle">Configure your capture settings, then save the generated link as a bookmark or home screen shortcut.</p>

      <div class="field">
        <label for="vault">Vault name</label>
        <input type="text" id="vault" placeholder="My Vault" autocomplete="off" spellcheck="false">
      </div>

      <div class="field">
        <label for="folder">Target folder</label>
        <input type="text" id="folder" placeholder="Inbox" autocomplete="off" spellcheck="false">
      </div>

      <div class="field shortcut-name-field">
        <label for="shortcutName">Shortcut / bookmarklet name</label>
        <div class="name-emoji-row">
          <input type="text" id="shortcutEmoji" placeholder="📎" class="emoji-input" autocomplete="off" maxlength="2">
          <input type="text" id="shortcutName" placeholder="Capture to Obsidian" autocomplete="off">
        </div>
        <p class="field-hint">Name shown as bookmarklet label and iOS home screen title. Emoji used as the home screen icon (leave blank to use the first letter).</p>
      </div>

      <div class="field">
        <div class="checkbox-row">
          <input type="checkbox" id="canvas">
          <span>Canvas mode (saves as .canvas with link node)</span>
        </div>
      </div>

      <div id="propsSection">
        <h2>Custom frontmatter properties</h2>
        <div class="props-list" id="propsList"></div>
        <button class="secondary btn-add-prop" id="btnAddProp">+ Add property</button>
      </div>

      <p id="canvasPropsNote" class="canvas-props-note" style="display:none">
        Canvas files don't support frontmatter — custom properties are only available in markdown mode.
      </p>

      <button class="btn-generate" id="btnGenerate">Generate</button>

      <div id="outputSection" style="display:none" class="output-section">
        <p id="staleNotice" class="stale-notice" style="display:none">⚠ Settings changed — click Generate to update.</p>
        <h2>Your links</h2>

        <div class="output-block">
          <label>Use URL — open in Safari → Add to Home Screen</label>
          <div class="copy-row">
            <input type="text" id="useUrlInput" readonly>
            <button id="btnCopyUrl">Copy</button>
            <button id="btnOpenUrl">Open</button>
          </div>
        </div>

        <div class="output-block">
          <label>Bookmarklet — drag to your bookmarks toolbar</label>
          <a id="bookmarkletLink" class="bookmarklet-link" href="#">⚡ Capture to Obsidian</a>
        </div>

        <div class="instructions">
          <ol>
            <li><strong>Desktop:</strong> Drag the bookmarklet link above to your browser toolbar.</li>
            <li><strong>iPhone/iPad:</strong> Tap Open, then Share → Add to Home Screen. The icon and name will be set as configured above.</li>
            <li>On any page, click/tap the bookmark or shortcut to open the capture overlay.</li>
          </ol>
        </div>
      </div>
    </div>
  `;

  const canvasCheckbox = root.querySelector<HTMLInputElement>('#canvas')!;
  const propsSection = root.querySelector<HTMLElement>('#propsSection')!;
  const canvasPropsNote = root.querySelector<HTMLElement>('#canvasPropsNote')!;
  const propsList = root.querySelector<HTMLElement>('#propsList')!;
  const btnAddProp = root.querySelector<HTMLButtonElement>('#btnAddProp')!;
  const btnGenerate = root.querySelector<HTMLButtonElement>('#btnGenerate')!;
  const outputSection = root.querySelector<HTMLElement>('#outputSection')!;
  const useUrlInput = root.querySelector<HTMLInputElement>('#useUrlInput')!;
  const btnCopyUrl = root.querySelector<HTMLButtonElement>('#btnCopyUrl')!;
  const btnOpenUrl = root.querySelector<HTMLButtonElement>('#btnOpenUrl')!;
  const bookmarkletLink = root.querySelector<HTMLAnchorElement>('#bookmarkletLink')!;
  const staleNotice = root.querySelector<HTMLElement>('#staleNotice')!;
  let lastGeneratedSnapshot = '';

  function readCurrentConfig() {
    const vault = root.querySelector<HTMLInputElement>('#vault')!.value.trim();
    const folder = root.querySelector<HTMLInputElement>('#folder')!.value.trim();
    const canvas = canvasCheckbox.checked;
    const name = root.querySelector<HTMLInputElement>('#shortcutName')!.value.trim();
    const emoji = root.querySelector<HTMLInputElement>('#shortcutEmoji')!.value.trim();
    const props: Prop[] = canvas ? [] : Array.from(propsList.querySelectorAll('.prop-row')).map(row => ({
      k: row.querySelector<HTMLInputElement>('.prop-key')!.value.trim(),
      v: row.querySelector<HTMLInputElement>('.prop-val')!.value.trim(),
    })).filter(p => p.k);
    return { vault, folder, canvas, name, emoji, props };
  }

  function updateStaleNotice(): void {
    if (outputSection.style.display === 'none') return;
    const current = encodeConfig(readCurrentConfig()).toString();
    staleNotice.style.display = current === lastGeneratedSnapshot ? 'none' : 'block';
  }

  // Any input/change outside the output section (form fields, checkbox, props) re-evaluates staleness
  root.addEventListener('input', (e) => {
    if (!(e.target as HTMLElement).closest('#outputSection')) updateStaleNotice();
  });
  root.addEventListener('change', (e) => {
    if (!(e.target as HTMLElement).closest('#outputSection')) updateStaleNotice();
  });

  // Pre-populate fields from URL params (when arriving from the use view's "Edit" link)
  if (prefill) {
    const cfg = decodeConfig(prefill);
    if (cfg.vault) (root.querySelector<HTMLInputElement>('#vault')!).value = cfg.vault;
    if (cfg.folder) (root.querySelector<HTMLInputElement>('#folder')!).value = cfg.folder;
    if (cfg.name) (root.querySelector<HTMLInputElement>('#shortcutName')!).value = cfg.name;
    if (cfg.emoji) (root.querySelector<HTMLInputElement>('#shortcutEmoji')!).value = cfg.emoji;
    if (cfg.canvas) {
      canvasCheckbox.checked = true;
      propsSection.style.display = 'none';
      canvasPropsNote.style.display = 'block';
    }
    cfg.props.forEach(p => addPropRow(p.k, p.v));
  }

  // Toggle frontmatter props visibility based on canvas mode
  canvasCheckbox.addEventListener('change', () => {
    const isCanvas = canvasCheckbox.checked;
    propsSection.style.display = isCanvas ? 'none' : 'block';
    canvasPropsNote.style.display = isCanvas ? 'block' : 'none';
  });

  function addPropRow(k = '', v = ''): void {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = `
      <input type="text" placeholder="key" value="${escAttr(k)}" class="prop-key" spellcheck="false">
      <input type="text" placeholder="value" value="${escAttr(v)}" class="prop-val" spellcheck="false">
      <button class="danger btn-remove-prop">✕</button>
    `;
    row.querySelector<HTMLButtonElement>('.btn-remove-prop')!.addEventListener('click', () => {
      row.remove();
      updateStaleNotice();
    });
    propsList.appendChild(row);
  }

  btnAddProp.addEventListener('click', () => {
    addPropRow();
    updateStaleNotice();
  });

  btnGenerate.addEventListener('click', () => {
    const cfg = readCurrentConfig();
    if (!cfg.vault) {
      root.querySelector<HTMLInputElement>('#vault')!.focus();
      return;
    }

    const params = encodeConfig(cfg);
    const useUrl = `${window.location.origin}${window.location.pathname}?${params}`;
    const displayName = cfg.name || 'Capture to Obsidian';

    lastGeneratedSnapshot = params.toString();
    useUrlInput.value = useUrl;
    bookmarkletLink.href = generateBookmarklet(useUrl);
    bookmarkletLink.textContent = `⚡ ${displayName}`;
    staleNotice.style.display = 'none';
    outputSection.style.display = 'block';
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  btnOpenUrl.addEventListener('click', () => {
    const url = useUrlInput.value;
    if (!url) return;
    if (isIOS()) {
      window.location.href = url.replace(/^(https?):\/\//, 'x-safari-$1://');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  btnCopyUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(useUrlInput.value).then(() => {
      btnCopyUrl.textContent = 'Copied!';
      setTimeout(() => { btnCopyUrl.textContent = 'Copy'; }, 1500);
    }).catch(() => {
      useUrlInput.select();
    });
  });
}

function escAttr(str: string): string {
  return str.replace(/"/g, '&quot;');
}

/** Detect iOS — covers iPhone, iPad (including iPad reporting as MacIntel with touch). */
function isIOS(): boolean {
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as MacIntel; distinguish from desktop Firefox/Chrome via
  // the Safari-only `standalone` property on navigator.
  return navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1
    && 'standalone' in navigator;
}
