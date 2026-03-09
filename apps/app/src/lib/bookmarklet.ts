/**
 * Generate a bookmarklet javascript: URL that injects an iframe overlay
 * pointing at the configured Use view URL.
 *
 * Uses function stringification so the inner code stays readable and
 * maintainable — no manual minification needed.
 */
export function generateBookmarklet(configuredUrl: string): string {
  function bookmarkletFn(CONFIGURED_URL: string) {
    var ID = '__obsidian_capture__';
    var existing = document.getElementById(ID);
    if (existing) { existing.remove(); return; }
    var overlay = document.createElement('div');
    overlay.id = ID;
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;background:rgba(0,0,0,.6)';
    var html = document.documentElement.outerHTML;
    // Strip all scripts/styles — the app uses Readability on the structural HTML.
    var stripped = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

    // For YouTube, extract a compact metadata subset from window.ytInitialData
    // (set as a global by YouTube's own scripts; far smaller than the full HTML).
    var ytSubset: any = null;
    try {
      var ytGlobal = (window as any).ytInitialData;
      if (ytGlobal) {
        var ytData: any = typeof ytGlobal === 'string' ? JSON.parse(ytGlobal) : ytGlobal;
        var subset: any = {};
        var c: any = ytData.contents;
        if (c && c.twoColumnWatchNextResults) {
          // Desktop: keep only primary + secondary info renderers
          var items: any[] = c.twoColumnWatchNextResults?.results?.results?.contents ?? [];
          subset.contents = {
            twoColumnWatchNextResults: {
              results: { results: { contents: items.filter(function(item: any) {
                return item.videoPrimaryInfoRenderer || item.videoSecondaryInfoRenderer;
              }) } },
            },
          };
        } else if (c && c.singleColumnWatchNextResults) {
          // Mobile: keep slimVideoMetadataSectionRenderer items + description panel
          var mItems: any[] = c.singleColumnWatchNextResults?.results?.results?.contents ?? [];
          subset.contents = {
            singleColumnWatchNextResults: {
              results: { results: { contents: mItems.filter(function(item: any) {
                return item.slimVideoMetadataSectionRenderer;
              }) } },
            },
          };
          if (ytData.engagementPanels) {
            subset.engagementPanels = (ytData.engagementPanels as any[]).filter(function(p: any) {
              var epslr: any = p.engagementPanelSectionListRenderer;
              return epslr && epslr.panelIdentifier === 'video-description-ep-identifier';
            });
          }
        }
        if (subset.contents) { ytSubset = subset; }
      }
    } catch (_e) { /* silent — app falls back to URL-only if extraction fails */ }

    var payload: any = { html: stripped };
    if (ytSubset) { payload.yt = ytSubset; }
    var b64 = btoa(
      Array.from(new TextEncoder().encode(JSON.stringify(payload)))
        .map(function(b) { return String.fromCharCode(b); })
        .join('')
    );
    var iframe = document.createElement('iframe') as HTMLIFrameElement;
    iframe.src = CONFIGURED_URL
      + '&mode=bm'
      + '&url=' + encodeURIComponent(location.href)
      + '&title=' + encodeURIComponent(document.title)
      + '#' + b64;
    iframe.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(500px,95vw);height:min(640px,90vh);border:none;border-radius:12px';
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    window.addEventListener('message', function handler(e: MessageEvent) {
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
