import './style.css';
import { renderConfigure } from './views/configure.js';
import { renderUse } from './views/use.js';

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app')!;

if (params.get('mode') === 'configure') {
  renderConfigure(app, params);
} else if (params.get('v')) {
  renderUse(app, params);
} else {
  renderConfigure(app);
}

checkForUpdate(app);

/**
 * Fetch ./version.json and compare to the build-time constant.
 * If they differ, prepend a refresh banner (at most once).
 * Re-checks whenever the page becomes visible again.
 */
function checkForUpdate(root: HTMLElement): void {
  if (import.meta.env.DEV) return;

  async function check(): Promise<void> {
    if (root.querySelector('.update-banner')) return;
    try {
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
