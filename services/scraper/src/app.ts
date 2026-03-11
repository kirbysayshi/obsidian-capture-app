import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fetch } from 'undici';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: process.env.ALLOWED_ORIGIN ?? '*',
    allowHeaders: ['Authorization'],
    allowMethods: ['GET', 'OPTIONS'],
  }),
);

app.get('/fetch', async (c) => {
  // Reject immediately if secret is not configured
  const scraperSecret = process.env.SCRAPER_SECRET;
  if (!scraperSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Auth check (read dynamically so tests can set env var before request)
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== scraperSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
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
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
