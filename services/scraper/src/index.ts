import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fetch } from 'undici';

const app = new Hono();

const PORT = parseInt(process.env.PORT ?? '8080', 10);

// CORS headers on every response
app.use('*', async (c, next) => {
  await next();
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? '*';
  c.res.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  c.res.headers.set('Access-Control-Allow-Headers', 'Authorization');
});

// Preflight
app.options('/fetch', (c) => {
  return c.body(null, 204);
});

app.get('/fetch', async (c) => {
  // Auth check (read dynamically so tests can set env var before request)
  const scraperSecret = process.env.SCRAPER_SECRET ?? '';
  if (scraperSecret) {
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== scraperSecret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  // URL validation
  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return c.json({ error: 'Missing url param' }, 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return c.json({ error: 'Invalid URL' }, 400);
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return c.json({ error: 'Only http/https URLs are supported' }, 400);
  }

  // Fetch upstream
  try {
    const resp = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ObsidianCaptureScraper/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return c.json({ error: `Upstream returned ${resp.status}` }, 502);
    }

    const html = await resp.text();
    const finalUrl = resp.url || targetUrl.toString();

    return c.json({ html, url: finalUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Fetch failed: ${msg}` }, 502);
  }
});

export { app };

// Start server only when run directly (not when imported in tests)
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1].replace(/\\/g, '/')) {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Scraper service listening on http://localhost:${info.port}`);
  });
}
