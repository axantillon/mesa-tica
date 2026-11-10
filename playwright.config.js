import { defineConfig, devices } from '@playwright/test';

// Each test starts its own in-process app on an isolated data directory (see e2e/fixtures.js),
// so no shared server or global state is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 4,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'phone',
      testMatch: /(customer|recovery|confirmation|tracking)\.spec\.js/,
      use: { ...devices['Pixel 7'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    {
      name: 'desktop',
      testMatch: /(staff|experience)\.spec\.js/,
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
  ],
});
