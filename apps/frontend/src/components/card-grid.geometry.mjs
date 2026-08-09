import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, fixtureTitle, measure } from './card-grid.geometry-measure.mjs';
import {
  GeometryRunnerError,
  remaining,
  startServer,
  stopServer,
  within,
} from './card-grid.geometry-runtime.mjs';

const frontendRoot = fileURLToPath(new URL('../../', import.meta.url));
const requireFromFrontend = createRequire(
  new URL('../../package.json', import.meta.url),
);
const { chromium } = requireFromFrontend('@playwright/test');
const totalTimeoutMs = 90_000;
const cleanupReserveMs = 10_000;

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function execute() {
  const started = Date.now();
  const totalDeadline = started + totalTimeoutMs;
  const workDeadline = totalDeadline - cleanupReserveMs;
  const output = argumentValue('--output');
  const screenshots = argumentValue('--screenshots');
  const results = [];
  let browser;
  let server;
  let failure;
  let browserClosed = false;
  try {
    server = await startServer({
      cwd: frontendRoot,
      env: {
        ...process.env,
        BACKEND_ORIGIN: 'http://127.0.0.1:4000',
        NODE_ENV: 'development',
        OSS_HUB_LOCAL_REVIEW_FIXTURES: '1',
      },
      totalDeadline,
      workDeadline,
    });
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      timeout: remaining(workDeadline, 'browser-launch'),
    });
    const page = await within(browser.newPage(), workDeadline, 'page-create');
    await page.goto(
      `http://127.0.0.1:${server.port}/local-review/anonymous?to=/programs`,
      {
        timeout: remaining(workDeadline, 'fixture-navigation'),
      },
    );
    await page.goto(
      `http://127.0.0.1:${server.port}/programs?status=recruiting`,
      {
        timeout: remaining(workDeadline, 'program-navigation'),
      },
    );
    await page
      .locator('[data-slot="program-card"]')
      .filter({ hasText: fixtureTitle })
      .first()
      .waitFor({ timeout: remaining(workDeadline, 'card-readiness') });
    if (screenshots !== undefined)
      await mkdir(screenshots, { recursive: true });
    for (const specification of cases) {
      const result = await measure(page, specification, workDeadline);
      results.push(result);
      if (screenshots !== undefined) {
        await page.screenshot({
          path: path.join(screenshots, `${result.name}.png`),
          fullPage: true,
          style: 'nextjs-portal { display: none !important; }',
          timeout: remaining(workDeadline, `${result.name}-screenshot`),
        });
      }
    }
  } catch (error) {
    failure =
      error instanceof Error
        ? error
        : new GeometryRunnerError('unknown', String(error));
  } finally {
    try {
      if (browser !== undefined) {
        const browserDeadline = Math.min(totalDeadline, Date.now() + 3_000);
        await within(browser.close(), browserDeadline, 'browser-cleanup');
        browserClosed = true;
      }
    } catch (error) {
      failure ??=
        error instanceof Error
          ? error
          : new GeometryRunnerError('cleanup', String(error));
    }
    try {
      if (server !== undefined) await stopServer(server.child, totalDeadline);
    } catch (error) {
      failure ??=
        error instanceof Error
          ? error
          : new GeometryRunnerError('cleanup', String(error));
    }
  }
  const receipt = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    result: failure === undefined ? 'PASS' : 'FAIL',
    port: server?.port ?? null,
    bindAttempt: server?.attempt ?? null,
    browserClosed,
    serverStopped: server === undefined || server.child.exitCode !== null,
    cases: results,
    failure: failure?.stack ?? null,
    serverLogTail:
      server?.logs.join('').split('\n').slice(-20) ??
      (failure instanceof GeometryRunnerError ? failure.logTail : []),
  };
  if (output !== undefined) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(
      path.resolve(output),
      `${JSON.stringify(receipt, null, 2)}\n`,
      'utf8',
    );
  }
  console.log(JSON.stringify(receipt));
  if (failure !== undefined) throw failure;
}

execute().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
