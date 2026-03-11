import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serve } from '@hono/node-server';
import { app } from './app';

// ── Upstream mock server ───────────────────────────────────────────────────────

let mockServer: http.Server;
let mockPort: number;
let mockStatusCode = 200;
let mockBody = '<html><body>Hello</body></html>';
let mockRedirectTarget = '';

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((_req, res) => {
      if (mockRedirectTarget) {
        res.writeHead(301, { Location: mockRedirectTarget });
        res.end();
        return;
      }
      res.writeHead(mockStatusCode, { 'Content-Type': 'text/html' });
      res.end(mockBody);
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = (mockServer.address() as { port: number }).port;
      resolve();
    });
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer.closeAllConnections?.();
    mockServer.close(() => resolve());
  });
}

// ── Scraper service ────────────────────────────────────────────────────────────

let scraperServer: ReturnType<typeof serve>;
let scraperPort: number;

function startScraperService(): Promise<void> {
  return new Promise((resolve) => {
    process.env.SCRAPER_SECRET = 'test-secret';
    scraperServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
      scraperPort = info.port;
      resolve();
    });
  });
}

function stopScraperService(): Promise<void> {
  return new Promise((resolve) => {
    (scraperServer as any).closeAllConnections?.();
    scraperServer.close(() => resolve());
  });
}

function scraperFetch(
  urlParam: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const endpoint = `http://127.0.0.1:${scraperPort}/fetch?url=${encodeURIComponent(urlParam)}`;
  return fetch(endpoint, { headers });
}

function mockUrl(): string {
  return `http://127.0.0.1:${mockPort}/page`;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

before(async () => {
  await startMockServer();
  await startScraperService();
});

after(async () => {
  await stopScraperService();
  await stopMockServer();
});

describe('Scraper service', () => {
  it('1. valid URL + correct auth → 200 {html, url}', async () => {
    mockStatusCode = 200;
    mockBody = '<html><body>Test page</body></html>';
    mockRedirectTarget = '';

    const resp = await scraperFetch(mockUrl(), {
      Authorization: 'Bearer test-secret',
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as { html: string; url: string };
    assert.ok(body.html.includes('Test page'));
    assert.ok(typeof body.url === 'string');
  });

  it('2. valid URL, no auth header → 401', async () => {
    const resp = await scraperFetch(mockUrl());
    assert.equal(resp.status, 401);
  });

  it('3. valid URL, wrong secret → 401', async () => {
    const resp = await scraperFetch(mockUrl(), {
      Authorization: 'Bearer wrong-secret',
    });
    assert.equal(resp.status, 401);
  });

  it('4. missing url param → 400', async () => {
    const resp = await fetch(`http://127.0.0.1:${scraperPort}/fetch`, {
      headers: { Authorization: 'Bearer test-secret' },
    });
    assert.equal(resp.status, 400);
  });

  it('5. non-http URL → 400', async () => {
    const resp = await scraperFetch('ftp://example.com/file', {
      Authorization: 'Bearer test-secret',
    });
    assert.equal(resp.status, 400);
  });

  it('6. upstream 404 → 502', async () => {
    mockStatusCode = 404;
    mockBody = 'Not found';
    mockRedirectTarget = '';

    const resp = await scraperFetch(mockUrl(), {
      Authorization: 'Bearer test-secret',
    });
    assert.equal(resp.status, 502);
  });

  it('7. upstream redirect → 200, url = final URL', async () => {
    mockStatusCode = 200;
    mockBody = '<html><body>Final destination</body></html>';
    mockRedirectTarget = '';

    // Temporary server that redirects /redirect → mockUrl()
    const { server: redirectServer, port: redirectPort } = await new Promise<{
      server: http.Server;
      port: number;
    }>((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(301, { Location: mockUrl() });
        res.end();
      });
      server.listen(0, '127.0.0.1', () =>
        resolve({ server, port: (server.address() as { port: number }).port }),
      );
    });

    try {
      const redirectUrl = `http://127.0.0.1:${redirectPort}/redirect`;
      const resp = await scraperFetch(redirectUrl, {
        Authorization: 'Bearer test-secret',
      });
      assert.equal(resp.status, 200);
      const body = (await resp.json()) as { html: string; url: string };
      assert.ok(body.html.includes('Final destination'));
      // Final URL should differ from the original redirect URL
      assert.notEqual(body.url, redirectUrl);
    } finally {
      await new Promise<void>((resolve) => {
        redirectServer.closeAllConnections?.();
        redirectServer.close(() => resolve());
      });
    }
  });
});
