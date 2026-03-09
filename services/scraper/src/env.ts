import dotenv from 'dotenv';

dotenv.config({
  // Vite Conventions: https://vite.dev/guide/env-and-mode#env-files
  override: true,
  path: [
    '.env',
    '.env.local',
    `.env.${process.env['NODE_ENV']}`,
    `.env.${process.env['NODE_ENV']}.local`,
  ],
});
