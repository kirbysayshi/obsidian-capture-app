import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.{js,ts,mjs}',
  webServer: {
    command: 'pnpm exec vite --port 5174',
    port: 5174,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:5174/',
  },
});
