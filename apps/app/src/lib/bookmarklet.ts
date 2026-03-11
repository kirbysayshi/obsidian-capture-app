/**
 * Generate a bookmarklet javascript: URL that injects an iframe overlay
 * pointing at the configured Use view URL.
 *
 * The bookmarklet passes location.href and document.title as URL params;
 * the app pre-fills the "what" field and lets the scraper service do
 * content extraction — no client-side HTML/YouTube extraction needed.
 */
export function generateBookmarklet(configuredUrl: string): string {
  function bookmarkletFn(CONFIGURED_URL: string) {
    var ID = '__obsidian_capture__';
    var existing = document.getElementById(ID);
    if (existing) { existing.remove(); return; }
    var overlay = document.createElement('div');
    overlay.id = ID;
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;background:rgba(0,0,0,.6)';
    var iframe = document.createElement('iframe');
    iframe.src = CONFIGURED_URL
      + '&mode=bm'
      + '&url=' + encodeURIComponent(location.href)
      + '&title=' + encodeURIComponent(document.title);
    iframe.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(500px,95vw);height:min(640px,90vh);border:none;border-radius:12px';
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    window.addEventListener('message', function handler(e) {
      if (e.source !== iframe.contentWindow) return;
      if (e.data && e.data.type === 'close') {
        overlay.remove();
        window.removeEventListener('message', handler);
      }
    });
  }
  const code = `(${bookmarkletFn.toString()})(${JSON.stringify(configuredUrl)})`;
  return `javascript:${encodeURIComponent(code)}`;
}
