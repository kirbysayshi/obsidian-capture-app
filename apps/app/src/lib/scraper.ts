export interface ScrapeResult { html: string; url: string; }

export async function scrapeUrl(serviceUrl: string, secret: string, targetUrl: string): Promise<ScrapeResult> {
  const endpoint = `${serviceUrl.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(targetUrl)}`;
  const headers: Record<string, string> = {};
  if (secret) headers['Authorization'] = `Bearer ${secret}`;
  const resp = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<ScrapeResult>;
}

/** Return the first http/https URL from text, stripping trailing punctuation. */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[.,;:!?)]+$/, '') : null;
}
