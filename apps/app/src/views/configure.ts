import {
  encodeInstances,
  decodeInstances,
  decodeConfig,
  type Config,
  type Prop,
} from '../lib/config.js';
import { generateBookmarklet } from '../lib/bookmarklet.js';

export function renderConfigure(
  root: HTMLElement,
  prefill?: URLSearchParams | null,
): void {
  root.innerHTML = `
    <div class="configure-view">
      <h1>Obsidian Capture</h1>
      <p class="subtitle">Configure your capture settings, then save the generated link as a bookmark or home screen shortcut.</p>

      <div class="field">
        <label>Shortcut / home screen name</label>
        <div class="name-emoji-row">
          <input type="text" id="globalEmojiInput" class="emoji-input" placeholder="⚡" autocomplete="off" maxlength="2">
          <input type="text" id="globalNameInput" placeholder="Capture to Obsidian" autocomplete="off">
        </div>
        <p class="field-hint">Name and icon used for the bookmark button and iOS home screen shortcut. Leave blank to use the first instance.</p>
      </div>

      <div class="field">
        <label>Scraper service URL</label>
        <input type="url" id="scraperUrlInput" autocomplete="off">
        <p class="field-hint">URL of the scraper service used to auto-fetch page content from the home screen app.</p>
      </div>
      <div class="field">
        <label>Scraper secret</label>
        <input type="text" id="scraperSecretInput" placeholder="Bearer secret" autocomplete="off">
      </div>

      <div id="instancesList"></div>
      <button class="secondary btn-add-instance" id="btnAddInstance" type="button">+ Add instance</button>

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

        <div class="output-block">
          <label>iOS Shortcut base URL — paste into the Shortcut template</label>
          <div class="copy-row">
            <input type="text" id="shortcutUrlInput" readonly>
            <button id="btnCopyShortcutUrl">Copy</button>
          </div>
          <p class="field-hint">
            Use this URL in the <em>Capture to Obsidian</em> Shortcut. The Shortcut fetches the shared page,
            Base64-encodes the HTML, and appends it as a fragment so the capture form can extract content —
            useful on Firefox iOS where the bookmarklet is blocked by strict CSP.
          </p>
        </div>

        <div class="instructions">
          <ol>
            <li><strong>Desktop:</strong> Drag the bookmarklet link above to your browser toolbar.</li>
            <li><strong>iPhone/iPad (Safari):</strong> Tap Open, then Share → Add to Home Screen. The icon and name will be set as configured above.</li>
            <li><strong>iPhone/iPad (Firefox):</strong> Use the iOS Shortcut — share any page to it and the capture form opens with content pre-filled.</li>
          </ol>
        </div>
      </div>
    </div>
  `;

  const instancesList = root.querySelector<HTMLElement>('#instancesList')!;
  const globalNameInput =
    root.querySelector<HTMLInputElement>('#globalNameInput')!;
  const globalEmojiInput =
    root.querySelector<HTMLInputElement>('#globalEmojiInput')!;
  const scraperUrlInput =
    root.querySelector<HTMLInputElement>('#scraperUrlInput')!;
  const scraperSecretInput = root.querySelector<HTMLInputElement>(
    '#scraperSecretInput',
  )!;
  const btnAddInstance =
    root.querySelector<HTMLButtonElement>('#btnAddInstance')!;
  const btnGenerate = root.querySelector<HTMLButtonElement>('#btnGenerate')!;
  const outputSection = root.querySelector<HTMLElement>('#outputSection')!;
  const useUrlInput = root.querySelector<HTMLInputElement>('#useUrlInput')!;
  const btnCopyUrl = root.querySelector<HTMLButtonElement>('#btnCopyUrl')!;
  const btnOpenUrl = root.querySelector<HTMLButtonElement>('#btnOpenUrl')!;
  const bookmarkletLink =
    root.querySelector<HTMLAnchorElement>('#bookmarkletLink')!;
  const shortcutUrlInput =
    root.querySelector<HTMLInputElement>('#shortcutUrlInput')!;
  const btnCopyShortcutUrl = root.querySelector<HTMLButtonElement>(
    '#btnCopyShortcutUrl',
  )!;
  const staleNotice = root.querySelector<HTMLElement>('#staleNotice')!;
  let lastGeneratedSnapshot = '';

  // ── Instance card factory ─────────────────────────────────────────────────

  function createInstanceCard(
    cfg?: Partial<Config>,
    expanded = true,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'instance-card';
    card.dataset.expanded = expanded ? 'true' : 'false';

    const defaultEmoji = cfg?.emoji ?? '';
    const defaultName = cfg?.name ?? '';
    const headerLabel = makeHeaderLabel(defaultEmoji, defaultName);

    card.innerHTML = `
      <div class="instance-header">
        <button class="instance-toggle" type="button" aria-label="Toggle">${expanded ? '▼' : '▶'}</button>
        <span class="instance-header-label">${escHtml(headerLabel)}</span>
        <button class="btn-sort-up instance-sort-btn" type="button" title="Move up" aria-label="Move up">↑</button>
        <button class="btn-sort-down instance-sort-btn" type="button" title="Move down" aria-label="Move down">↓</button>
        <button class="btn-remove-instance danger" type="button" aria-label="Remove instance">✕</button>
      </div>
      <div class="instance-body" style="${expanded ? '' : 'display:none'}">
        <div class="field">
          <label>Vault name</label>
          <input type="text" class="vault-input" placeholder="My Vault" autocomplete="off" spellcheck="false" value="${escAttr(cfg?.vault ?? '')}">
        </div>

        <div class="field">
          <label>Target folder</label>
          <input type="text" class="folder-input" placeholder="Inbox" autocomplete="off" spellcheck="false" value="${escAttr(cfg?.folder ?? '')}">
        </div>

        <div class="field shortcut-name-field">
          <label>Name</label>
          <div class="name-emoji-row">
            <input type="text" class="shortcut-emoji-input emoji-input" placeholder="📎" autocomplete="off" maxlength="2" value="${escAttr(cfg?.emoji ?? '')}">
            <input type="text" class="shortcut-name-input" placeholder="Capture to Obsidian" autocomplete="off" value="${escAttr(cfg?.name ?? '')}">
          </div>
          <p class="field-hint">Shown in the picker and as the form heading. Emoji used as the icon.</p>
        </div>

        <div class="field">
          <div class="checkbox-row">
            <input type="checkbox" class="canvas-checkbox"${cfg?.canvas ? ' checked' : ''}>
            <span>Canvas mode (saves as .canvas with link node)</span>
          </div>
        </div>

        <div class="props-section"${cfg?.canvas ? ' style="display:none"' : ''}>
          <h2>Custom frontmatter properties</h2>
          <div class="props-list"></div>
          <button class="secondary btn-add-prop" type="button">+ Add property</button>
        </div>

        <p class="canvas-props-note" style="${cfg?.canvas ? '' : 'display:none'}">
          Canvas files don't support frontmatter — custom properties are only available in markdown mode.
        </p>
      </div>
    `;

    const body = card.querySelector<HTMLElement>('.instance-body')!;
    const toggleBtn =
      card.querySelector<HTMLButtonElement>('.instance-toggle')!;
    const removeBtn = card.querySelector<HTMLButtonElement>(
      '.btn-remove-instance',
    )!;
    const sortUpBtn = card.querySelector<HTMLButtonElement>('.btn-sort-up')!;
    const sortDownBtn =
      card.querySelector<HTMLButtonElement>('.btn-sort-down')!;
    const headerLabelEl = card.querySelector<HTMLElement>(
      '.instance-header-label',
    )!;
    const emojiInput = card.querySelector<HTMLInputElement>(
      '.shortcut-emoji-input',
    )!;
    const nameInput = card.querySelector<HTMLInputElement>(
      '.shortcut-name-input',
    )!;
    const canvasCheckbox =
      card.querySelector<HTMLInputElement>('.canvas-checkbox')!;
    const propsSection = card.querySelector<HTMLElement>('.props-section')!;
    const canvasPropsNote =
      card.querySelector<HTMLElement>('.canvas-props-note')!;
    const propsList = card.querySelector<HTMLElement>('.props-list')!;
    const btnAddProp = card.querySelector<HTMLButtonElement>('.btn-add-prop')!;

    // Toggle collapse/expand (button or label click)
    function toggleCard(): void {
      const isExpanded = card.dataset.expanded === 'true';
      card.dataset.expanded = isExpanded ? 'false' : 'true';
      toggleBtn.textContent = isExpanded ? '▶' : '▼';
      body.style.display = isExpanded ? 'none' : '';
    }
    toggleBtn.addEventListener('click', toggleCard);
    headerLabelEl.addEventListener('click', toggleCard);

    // Remove card
    removeBtn.addEventListener('click', () => {
      card.remove();
      updateCardButtons();
      updateStaleNotice();
    });

    // Sort card up/down
    sortUpBtn.addEventListener('click', () => {
      const prev = card.previousElementSibling;
      if (prev) instancesList.insertBefore(card, prev);
      updateCardButtons();
      updateStaleNotice();
    });
    sortDownBtn.addEventListener('click', () => {
      const next = card.nextElementSibling;
      if (next) instancesList.insertBefore(next, card);
      updateCardButtons();
      updateStaleNotice();
    });

    // Update header label live
    function refreshLabel(): void {
      headerLabelEl.textContent = makeHeaderLabel(
        emojiInput.value.trim(),
        nameInput.value.trim(),
      );
    }
    emojiInput.addEventListener('input', refreshLabel);
    nameInput.addEventListener('input', refreshLabel);

    // Canvas toggle
    canvasCheckbox.addEventListener('change', () => {
      const isCanvas = canvasCheckbox.checked;
      propsSection.style.display = isCanvas ? 'none' : '';
      canvasPropsNote.style.display = isCanvas ? '' : 'none';
    });

    // Prop rows
    function addPropRow(k = '', v = '', type: Prop['type'] = 'text'): void {
      const row = document.createElement('div');
      row.className = 'prop-row';
      row.dataset.propType = type ?? 'text';
      row.innerHTML = `
        <button class="prop-type-icon" type="button">≡</button>
        <input type="text" placeholder="key" value="${escAttr(k)}" class="prop-key" spellcheck="false">
        <input type="text" placeholder="value" value="${escAttr(v)}" class="prop-val" spellcheck="false">
        <label class="prop-bool-default">
          <input type="checkbox" class="prop-bool-check">
          <span>default</span>
        </label>
        <button class="danger btn-remove-prop">✕</button>
      `;

      const typeIcon = row.querySelector<HTMLButtonElement>('.prop-type-icon')!;
      const valInput = row.querySelector<HTMLInputElement>('.prop-val')!;
      const boolDefault = row.querySelector<HTMLElement>('.prop-bool-default')!;
      const boolCheck =
        row.querySelector<HTMLInputElement>('.prop-bool-check')!;

      function applyType(t: Prop['type']): void {
        row.dataset.propType = t;
        const isBool = t === 'boolean';
        typeIcon.textContent = isBool ? '☑' : '≡';
        typeIcon.title = isBool ? 'Switch to text' : 'Switch to boolean';
        valInput.style.display = isBool ? 'none' : '';
        boolDefault.style.display = isBool ? '' : 'none';
      }

      if (v === 'true') boolCheck.checked = true;
      applyType(type ?? 'text');

      typeIcon.addEventListener('click', () => {
        applyType(row.dataset.propType === 'boolean' ? 'text' : 'boolean');
        updateStaleNotice();
      });
      boolCheck.addEventListener('change', updateStaleNotice);
      row
        .querySelector<HTMLButtonElement>('.btn-remove-prop')!
        .addEventListener('click', () => {
          row.remove();
          updateStaleNotice();
        });
      propsList.appendChild(row);
    }

    // Prefill props
    if (cfg?.props) {
      cfg.props.forEach((p) => addPropRow(p.k, p.v, p.type));
    }

    btnAddProp.addEventListener('click', () => {
      addPropRow();
      updateStaleNotice();
    });

    return card;
  }

  function readCard(card: HTMLElement): Config {
    const vault = card
      .querySelector<HTMLInputElement>('.vault-input')!
      .value.trim();
    const folder = card
      .querySelector<HTMLInputElement>('.folder-input')!
      .value.trim();
    const canvas =
      card.querySelector<HTMLInputElement>('.canvas-checkbox')!.checked;
    const name = card
      .querySelector<HTMLInputElement>('.shortcut-name-input')!
      .value.trim();
    const emoji = card
      .querySelector<HTMLInputElement>('.shortcut-emoji-input')!
      .value.trim();
    const propsList = card.querySelector<HTMLElement>('.props-list')!;
    const props: Prop[] = canvas
      ? []
      : Array.from(propsList.querySelectorAll<HTMLElement>('.prop-row'))
          .map((row) => {
            const k = row
              .querySelector<HTMLInputElement>('.prop-key')!
              .value.trim();
            const type = (row.dataset.propType || 'text') as Prop['type'];
            const v =
              type === 'boolean'
                ? row.querySelector<HTMLInputElement>('.prop-bool-check')!
                    .checked
                  ? 'true'
                  : 'false'
                : row
                    .querySelector<HTMLInputElement>('.prop-val')!
                    .value.trim();
            return { k, v, type };
          })
          .filter((p) => p.k);
    return { vault, folder, canvas, name, emoji, props };
  }

  function readAllInstances(): Config[] {
    return Array.from(
      instancesList.querySelectorAll<HTMLElement>('.instance-card'),
    ).map(readCard);
  }

  function updateCardButtons(): void {
    const cards = Array.from(
      instancesList.querySelectorAll<HTMLElement>('.instance-card'),
    );
    cards.forEach((card, i) => {
      card.querySelector<HTMLButtonElement>(
        '.btn-remove-instance',
      )!.style.display = cards.length === 1 ? 'none' : '';
      card.querySelector<HTMLButtonElement>('.btn-sort-up')!.style.display =
        i === 0 ? 'none' : '';
      card.querySelector<HTMLButtonElement>('.btn-sort-down')!.style.display =
        i === cards.length - 1 ? 'none' : '';
    });
  }

  function getSnapshot(): string {
    return JSON.stringify({
      sn: globalNameInput.value.trim(),
      se: globalEmojiInput.value.trim(),
      su: scraperUrlInput.value.trim(),
      ss: scraperSecretInput.value.trim(),
      instances: readAllInstances(),
    });
  }

  function updateStaleNotice(): void {
    if (outputSection.style.display === 'none') return;
    staleNotice.style.display =
      getSnapshot() === lastGeneratedSnapshot ? 'none' : 'block';
  }

  function addCard(cfg?: Partial<Config>, expanded = false): void {
    const card = createInstanceCard(cfg, expanded);
    instancesList.appendChild(card);
    updateCardButtons();
  }

  // ── Listen for changes ────────────────────────────────────────────────────

  root.addEventListener('input', (e) => {
    if (!(e.target as HTMLElement).closest('#outputSection'))
      updateStaleNotice();
  });
  root.addEventListener('change', (e) => {
    if (!(e.target as HTMLElement).closest('#outputSection'))
      updateStaleNotice();
  });

  // ── Prefill or blank start ────────────────────────────────────────────────

  scraperUrlInput.value =
    prefill?.get('su') ?? import.meta.env.VITE_SCRAPER_URL ?? '';
  scraperSecretInput.value = prefill?.get('ss') ?? '';

  if (prefill) {
    const sn = prefill.get('sn');
    const se = prefill.get('se');
    if (sn) globalNameInput.value = sn;
    if (se) globalEmojiInput.value = se;
  }

  if (prefill?.get('instances')) {
    const instances = decodeInstances(prefill);
    if (instances && instances.length > 0) {
      instances.forEach((cfg, i) => addCard(cfg, i === 0));
    } else {
      addCard(undefined, true);
    }
  } else if (prefill?.get('v')) {
    // Legacy single-instance prefill from old ?v= URLs
    const cfg = decodeConfig(prefill);
    addCard(cfg, true);
  } else {
    addCard(undefined, true);
  }

  // ── Add instance button ───────────────────────────────────────────────────

  btnAddInstance.addEventListener('click', () => {
    addCard(undefined, true);
    updateStaleNotice();
  });

  // ── Generate ──────────────────────────────────────────────────────────────

  btnGenerate.addEventListener('click', () => {
    const instances = readAllInstances();
    const cards = Array.from(
      instancesList.querySelectorAll<HTMLElement>('.instance-card'),
    );
    for (let i = 0; i < instances.length; i++) {
      const missingVault = !instances[i].vault;
      const missingFolder = !instances[i].folder;
      if (missingVault || missingFolder) {
        // Expand card if collapsed so the field is visible
        const card = cards[i];
        if (card.dataset.expanded !== 'true') {
          card.dataset.expanded = 'true';
          card.querySelector<HTMLButtonElement>(
            '.instance-toggle',
          )!.textContent = '▼';
          card.querySelector<HTMLElement>('.instance-body')!.style.display = '';
        }
        card
          .querySelector<HTMLInputElement>(
            missingVault ? '.vault-input' : '.folder-input',
          )
          ?.focus();
        return;
      }
    }

    const params = encodeInstances(instances);
    const globalName = globalNameInput.value.trim();
    const globalEmoji = globalEmojiInput.value.trim();
    const scraperUrl = scraperUrlInput.value.trim();
    const scraperSecret = scraperSecretInput.value.trim();
    if (globalName) params.set('sn', globalName);
    if (globalEmoji) params.set('se', globalEmoji);
    if (scraperUrl) params.set('su', scraperUrl);
    if (scraperSecret) params.set('ss', scraperSecret);
    const useUrl = `${window.location.origin}${window.location.pathname}?${params}`;
    const firstInstance = instances[0];
    const displayName =
      globalName || firstInstance.name || 'Capture to Obsidian';
    const displayEmoji = globalEmoji || firstInstance.emoji || '⚡';

    lastGeneratedSnapshot = getSnapshot();
    useUrlInput.value = useUrl;
    shortcutUrlInput.value = useUrl;
    bookmarkletLink.href = generateBookmarklet(useUrl);
    bookmarkletLink.textContent = `${displayEmoji} ${displayName}`;
    staleNotice.style.display = 'none';
    outputSection.style.display = 'block';
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ── Copy / Open buttons ───────────────────────────────────────────────────

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
    navigator.clipboard
      .writeText(useUrlInput.value)
      .then(() => {
        btnCopyUrl.textContent = 'Copied!';
        setTimeout(() => {
          btnCopyUrl.textContent = 'Copy';
        }, 1500);
      })
      .catch(() => {
        useUrlInput.select();
      });
  });

  btnCopyShortcutUrl.addEventListener('click', () => {
    navigator.clipboard
      .writeText(shortcutUrlInput.value)
      .then(() => {
        btnCopyShortcutUrl.textContent = 'Copied!';
        setTimeout(() => {
          btnCopyShortcutUrl.textContent = 'Copy';
        }, 1500);
      })
      .catch(() => {
        shortcutUrlInput.select();
      });
  });
}

function makeHeaderLabel(emoji: string, name: string): string {
  const icon = emoji || '📎';
  const label = name || 'Capture to Obsidian';
  return `${icon} ${label}`;
}

function escAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Detect iOS — covers iPhone, iPad (including iPad reporting as MacIntel with touch). */
function isIOS(): boolean {
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return (
    navigator.platform === 'MacIntel' &&
    navigator.maxTouchPoints > 1 &&
    'standalone' in navigator
  );
}
