const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const playwrightTestPackage = fs.realpathSync(
  path.resolve(
    __dirname,
    '../../../../apps/frontend/node_modules/@playwright/test',
  ),
);
const { chromium } = createRequire(
  path.join(playwrightTestPackage, 'package.json'),
)('playwright');

const PROGRAM_NAME = '2026 하계 SW 현장실습 연계 프로그램';
const HIDDEN_NAME = '2026 신입생 SW역량 강화 캠프';
const PROGRAM_ID = 'seed:demo:program:summer-internship';

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

async function main() {
  const frontendUrl = requiredEnv('VERIFY_FRONTEND_URL');
  const backendUrl = requiredEnv('VERIFY_BACKEND_URL');
  const evidenceDir = requiredEnv('VERIFY_EVIDENCE_DIR');
  fs.mkdirSync(evidenceDir, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.goto(`${frontendUrl}/programs`, {
      waitUntil: 'domcontentloaded',
    });
    await page
      .getByRole('heading', { name: '프로그램', exact: true })
      .waitFor();
    const programLink = page.getByRole('link', { name: PROGRAM_NAME });
    await programLink.waitFor();
    await page.screenshot({
      path: path.join(evidenceDir, 'list.png'),
      fullPage: true,
    });
    fs.writeFileSync(
      path.join(evidenceDir, 'list.txt'),
      await page.locator('main').innerText(),
    );

    await page
      .getByRole('textbox', { name: '프로그램명 검색' })
      .fill('현장실습');
    await page.waitForURL(/[?&]search=/);
    await programLink.waitFor();
    await page.getByRole('link', { name: HIDDEN_NAME }).waitFor({
      state: 'hidden',
    });
    await page.screenshot({
      path: path.join(evidenceDir, 'search.png'),
      fullPage: true,
    });

    const apiUrl = new URL('/api/v1/programs', backendUrl);
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('pageSize', '20');
    apiUrl.searchParams.set('status', 'all');
    apiUrl.searchParams.set('search', '현장실습');
    const response = await page.request.get(apiUrl.toString());
    const body = await response.text();
    fs.writeFileSync(path.join(evidenceDir, 'search-api.json'), `${body}\n`);
    if (!response.ok()) {
      throw new Error(`program search API returned ${response.status()}`);
    }
    const payload = JSON.parse(body);
    if (!Array.isArray(payload.items)) {
      throw new Error('program search API did not return items');
    }
    const match = payload.items.find(
      (item) => item.id === PROGRAM_ID && item.name === PROGRAM_NAME,
    );
    if (match === undefined) {
      throw new Error('program search API did not return the seeded program');
    }
    if (payload.items.length !== 1) {
      throw new Error(
        `program search API returned ${payload.items.length} items`,
      );
    }

    await programLink.click();
    await page.getByRole('heading', { name: PROGRAM_NAME }).waitFor();
    if (!page.url().includes(encodeURIComponent(PROGRAM_ID))) {
      throw new Error(`detail URL did not contain ${PROGRAM_ID}`);
    }
    await page.screenshot({
      path: path.join(evidenceDir, 'detail.png'),
      fullPage: true,
    });
    fs.writeFileSync(
      path.join(evidenceDir, 'detail.txt'),
      await page.locator('main').innerText(),
    );
    process.stdout.write(`browse-programs: ${PROGRAM_ID}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
