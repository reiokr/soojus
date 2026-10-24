import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3210';

export default defineConfig({
  testDir: './e2e', timeout: 60000, workers: 1,
  use: {
    baseURL,
    locale: 'et-EE',
    viewport: { width: 1440, height: 1080 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined }
  },
  // Kohalikult kasutatakse juba töötavat teenust; CI-s (ilma E2E_BASE_URL-ita) käivitatakse `npm start`.
  webServer: process.env.E2E_BASE_URL || process.env.E2E_NO_SERVER ? undefined : {
    command: 'npm start',
    url: 'http://127.0.0.1:3210/api/status',
    reuseExistingServer: true,
    timeout: 120000
  },
  reporter: 'list',
});
