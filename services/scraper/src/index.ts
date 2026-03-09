import './env.js';
import { serve } from '@hono/node-server';
import { app } from './app.js';

if (!process.env.SCRAPER_SECRET) {
  throw new Error('SCRAPER_SECRET environment variable is required');
}

const PORT = parseInt(process.env.PORT ?? '8080', 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Scraper service listening on http://localhost:${info.port}`);
});
