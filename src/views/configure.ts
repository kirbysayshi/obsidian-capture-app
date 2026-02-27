import { encodeConfig, type Prop } from '../lib/config.js';
import { generateBookmarklet } from '../lib/bookmarklet.js';

export function renderConfigure(root: HTMLElement): void {
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

      <div class="field">
        <label for="shortcutName">Shortcut / bookmarklet name</label>
        <input type="text" id="shortcutName" placeholder="Capture to Obsidian" autocomplete="off">
        <p class="field-hint">Shown as the bookmarklet label and the iOS home screen icon name.</p>
      </div>

      <div class="field">
        <div class="checkbox-row">
          <input type="checkbox" id="canvas">
          <span>Canvas mode (saves as .canvas with link node)</span>
        </div>
      </div>

      <h2>Custom frontmatter properties</h2>
      <div class="props-list" id="propsList"></div>
      <button class="secondary btn-add-prop" id="btnAddProp">+ Add property</button>

      <button class="btn-generate" id="btnGenerate">Generate</button>

      <div id="outputSection" style="display:none" class="output-section">
        <h2>Your links</h2>

        <div class="output-block">
          <label>Use URL — open in Safari → Add to Home Screen</label>
          <div class="copy-row">
            <input type="text" id="useUrlInput" readonly>
            <button id="btnCopyUrl">Copy</button>
          </div>
        </div>

        <div class="output-block">
          <label>Bookmarklet — drag to your bookmarks toolbar</label>
          <a id="bookmarkletLink" class="bookmarklet-link" href="#">⚡ Capture to Obsidian</a>
        </div>

        <div class="instructions">
          <ol>
            <li><strong>Desktop:</strong> Drag the bookmarklet link above to your browser toolbar.</li>
            <li><strong>iPhone/iPad:</strong> Copy the Use URL, open it in Safari, tap Share → Add to Home Screen. The icon will be named as configured above.</li>
            <li>On any page, click/tap the bookmark or shortcut to open the capture overlay.</li>
          </ol>
        </div>
      </div>
    </div>
  `;

  const propsList = root.querySelector<HTMLElement>('#propsList')!;
  const btnAddProp = root.querySelector<HTMLButtonElement>('#btnAddProp')!;
  const btnGenerate = root.querySelector<HTMLButtonElement>('#btnGenerate')!;
  const outputSection = root.querySelector<HTMLElement>('#outputSection')!;
  const useUrlInput = root.querySelector<HTMLInputElement>('#useUrlInput')!;
  const btnCopyUrl = root.querySelector<HTMLButtonElement>('#btnCopyUrl')!;
  const bookmarkletLink = root.querySelector<HTMLAnchorElement>('#bookmarkletLink')!;

  function addPropRow(k = '', v = ''): void {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = `
      <input type="text" placeholder="key" value="${escAttr(k)}" class="prop-key" spellcheck="false">
      <input type="text" placeholder="value" value="${escAttr(v)}" class="prop-val" spellcheck="false">
      <button class="danger btn-remove-prop">✕</button>
    `;
    row.querySelector<HTMLButtonElement>('.btn-remove-prop')!.addEventListener('click', () => row.remove());
    propsList.appendChild(row);
  }

  btnAddProp.addEventListener('click', () => addPropRow());

  btnGenerate.addEventListener('click', () => {
    const vault = root.querySelector<HTMLInputElement>('#vault')!.value.trim();
    if (!vault) {
      root.querySelector<HTMLInputElement>('#vault')!.focus();
      return;
    }

    const folder = root.querySelector<HTMLInputElement>('#folder')!.value.trim();
    const canvas = root.querySelector<HTMLInputElement>('#canvas')!.checked;
    const name = root.querySelector<HTMLInputElement>('#shortcutName')!.value.trim();
    const props: Prop[] = Array.from(propsList.querySelectorAll('.prop-row')).map(row => ({
      k: row.querySelector<HTMLInputElement>('.prop-key')!.value.trim(),
      v: row.querySelector<HTMLInputElement>('.prop-val')!.value.trim(),
    })).filter(p => p.k);

    const params = encodeConfig({ vault, folder, canvas, name, props });
    const useUrl = `${window.location.origin}${window.location.pathname}?${params}`;
    const displayName = name || 'Capture to Obsidian';

    useUrlInput.value = useUrl;
    bookmarkletLink.href = generateBookmarklet(useUrl);
    bookmarkletLink.textContent = `⚡ ${displayName}`;
    outputSection.style.display = 'block';
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
