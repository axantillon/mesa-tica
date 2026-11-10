import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.mjs', workers: 1,
  timeout: 35000, expect: { timeout: 10000 }, retries: 0,
  use: { browserName: 'chromium', channel: 'chromium', viewport: { width: 1280, height: 900 }, trace: 'off', screenshot: 'off' },
  reporter: 'list',
});
