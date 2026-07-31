import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

import { e2eEnvironment } from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  outputDir:
    process.env.E2E_OUTPUT_DIR ??
    join(tmpdir(), `oss-hub-playwright-${process.pid}`),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: e2eEnvironment.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'bash e2e/run-stack.sh',
    url: e2eEnvironment.baseUrl,
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 10_000,
    },
  },
});
