import { defineConfig, devices } from '@playwright/test';

import { e2eEnvironment } from './e2e/environment';

export default defineConfig({
  testDir: './e2e',

  testIgnore: 'support/**',
  outputDir:
    process.env.E2E_OUTPUT_DIR ??
    process.env.E2E_ARTIFACT_DIR ??
    '.omo/artifacts/program-authoring-and-document-flow/12-e2e/playwright',
  fullyParallel: false,
  forbidOnly: true,
  preserveOutput: 'always',

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

    stdout: 'pipe',
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 10_000,
    },
  },
});
