/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SCRAPER_URL: string;
  readonly VITE_SCRAPER_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
