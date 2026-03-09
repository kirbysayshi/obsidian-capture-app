import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.{js,ts,mjs}',
  webServer: [
    {
      command: 'pnpm exec vite --port 5174',
      port: 5174,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter @obsidian-capture/scraper dev',
      port: 8080,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
  use: {
    baseURL: 'http://localhost:5174/',
    serviceWorkers: 'block',
  },
});
