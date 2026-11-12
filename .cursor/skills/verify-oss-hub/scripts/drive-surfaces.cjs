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

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'verification-fixtures.json'), 'utf8'),
);
const PROGRAM_ID = fixture.repository.programId;
const TEAM_ID = fixture.repository.teamId;
const PROGRAM_PATH = `/programs/${encodeURIComponent(PROGRAM_ID)}`;
const ALPHA = fixture.ranking[0];
const BETA = fixture.ranking[1];

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

async function openPage(browser, frontendUrl, cookieHeader) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  if (cookieHeader !== '') {
    const splitAt = cookieHeader.indexOf('=');
    if (splitAt < 1) {
      throw new Error('session cookie must look like oss_session_dev=<token>');
    }
    await context.addCookies([
      {
        name: cookieHeader.slice(0, splitAt),
        value: cookieHeader.slice(splitAt + 1),
        url: frontendUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  return { context, page: await context.newPage() };
}

function writeText(evidenceDir, name, text) {
  fs.writeFileSync(path.join(evidenceDir, name), text);
}

async function saveMain(page, evidenceDir, name) {
  const main = page.locator('main');
  const region = (await main.count()) > 0 ? main.first() : page.locator('body');
  writeText(evidenceDir, name, await region.innerText());
}

function rankingTotal(row) {
  return (
    row.commitCount +
    row.pullRequestCount +
    row.issueCount +
    row.repositoryCount +
    row.starCount
  );
}

async function driveRanking(browser, frontendUrl, backendUrl, evidenceDir) {
  const { context, page } = await openPage(browser, frontendUrl, '');
  try {
    await page.goto(`${frontendUrl}/ranking`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('heading', { name: '랭킹', exact: true }).waitFor();
    const table = page.getByRole('table').filter({ hasText: '순위' });
    await table.getByRole('link', { name: ALPHA.nickname }).waitFor();
    const logins = await table.getByRole('link').allTextContents();
    if (logins[0] !== ALPHA.nickname || logins[1] !== BETA.nickname) {
      throw new Error(`ranking order was ${logins.slice(0, 2).join(', ')}`);
    }
    const alphaRow = table.getByRole('row').filter({ hasText: ALPHA.nickname });
    const alphaCells = await alphaRow.getByRole('cell').allTextContents();
    const expectedAlpha = [
      String(ALPHA.commitCount),
      String(ALPHA.pullRequestCount),
      String(ALPHA.issueCount),
      String(ALPHA.repositoryCount),
      String(ALPHA.starCount),
      String(rankingTotal(ALPHA)),
    ];
    for (const value of expectedAlpha) {
      if (!alphaCells.includes(value)) {
        throw new Error(
          `ranking row for ${ALPHA.nickname} missing ${value}: ${alphaCells.join('|')}`,
        );
      }
    }
    await page.screenshot({
      path: path.join(evidenceDir, 'ranking.png'),
      fullPage: true,
    });
    await saveMain(page, evidenceDir, 'ranking.txt');

    const apiUrl = new URL('/api/v1/ranking', backendUrl);
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('pageSize', '20');
    const response = await page.request.get(apiUrl.toString());
    const body = await response.text();
    writeText(evidenceDir, 'ranking-api.json', `${body}\n`);
    if (!response.ok()) {
      throw new Error(`ranking API returned ${response.status()}`);
    }
    const payload = JSON.parse(body);
    const first = payload.items[0];
    const second = payload.items[1];
    if (
      first?.githubLogin !== ALPHA.nickname ||
      first.commitCount !== ALPHA.commitCount ||
      first.total !== rankingTotal(ALPHA) ||
      second?.githubLogin !== BETA.nickname ||
      second.commitCount !== BETA.commitCount ||
      second.total !== rankingTotal(BETA)
    ) {
      throw new Error('ranking API order or counts did not match the scaffold');
    }
    writeText(
      evidenceDir,
      'asserted.txt',
      [
        `${ALPHA.nickname} rank=1 total=${rankingTotal(ALPHA)} commit=${ALPHA.commitCount}`,
        `${BETA.nickname} rank=2 total=${rankingTotal(BETA)} commit=${BETA.commitCount}`,
      ].join('\n') + '\n',
    );
    process.stdout.write(
      `activity-ranking: ${ALPHA.nickname}=${rankingTotal(ALPHA)} ${BETA.nickname}=${rankingTotal(BETA)}\n`,
    );
  } finally {
    await context.close();
  }
}

async function driveTeamManagement(
  browser,
  frontendUrl,
  backendUrl,
  evidenceDir,
  studentCookie,
  staffCookie,
) {
  const teamsPath = `${PROGRAM_PATH}/teams`;
  const student = await openPage(browser, frontendUrl, studentCookie);
  try {
    await student.page.goto(`${frontendUrl}${teamsPath}`, {
      waitUntil: 'domcontentloaded',
    });
    await student.page.getByText('현장실습 A팀').waitFor();
    await student.page.getByText('팀장').first().waitFor();
    await student.page.screenshot({
      path: path.join(evidenceDir, 'student.png'),
      fullPage: true,
    });
    await saveMain(student.page, evidenceDir, 'student.txt');
  } finally {
    await student.context.close();
  }

  const staff = await openPage(browser, frontendUrl, staffCookie);
  try {
    await staff.page.goto(`${frontendUrl}${teamsPath}`, {
      waitUntil: 'domcontentloaded',
    });
    await staff.page
      .getByRole('heading', { name: '팀 관리', exact: true })
      .waitFor();
    await staff.page.getByRole('textbox', { name: '팀 검색' }).fill('현장실습');
    await staff.page.getByRole('button', { name: '검색', exact: true }).click();
    await staff.page.getByText('현장실습 A팀').waitFor();
    await staff.page.screenshot({
      path: path.join(evidenceDir, 'staff.png'),
      fullPage: true,
    });
    await saveMain(staff.page, evidenceDir, 'staff.txt');

    const apiUrl = new URL(
      `/api/v1/programs/${encodeURIComponent(PROGRAM_ID)}/teams`,
      frontendUrl,
    );
    apiUrl.searchParams.set('view', 'team-management');
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('pageSize', '20');
    apiUrl.searchParams.set('search', '현장실습');
    const response = await staff.page.request.get(apiUrl.toString());
    const body = await response.text();
    writeText(evidenceDir, 'staff-api.json', `${body}\n`);
    if (!response.ok()) {
      throw new Error(`team management API returned ${response.status()}`);
    }
    const payload = JSON.parse(body);
    const items = payload.items ?? payload.teams ?? [];
    const serialized = JSON.stringify(items);
    if (!serialized.includes(TEAM_ID) || !serialized.includes('현장실습 A팀')) {
      throw new Error('team management API did not return the internship team');
    }
  } finally {
    await staff.context.close();
  }

  const anonymous = await openPage(browser, frontendUrl, '');
  try {
    await anonymous.page.goto(`${frontendUrl}${teamsPath}`, {
      waitUntil: 'domcontentloaded',
    });
    await anonymous.page.getByText('로그인이 필요합니다').waitFor();
    if (
      await anonymous.page.getByRole('heading', { name: '팀 관리' }).count()
    ) {
      throw new Error('anonymous visitor saw the staff team list');
    }
    await anonymous.page.screenshot({
      path: path.join(evidenceDir, 'anonymous.png'),
      fullPage: true,
    });
    await saveMain(anonymous.page, evidenceDir, 'anonymous.txt');
  } finally {
    await anonymous.context.close();
  }
  process.stdout.write(`team-management: ${TEAM_ID}\n`);
}

async function columnSum(table, login) {
  const header = table.getByRole('columnheader', { name: `@${login}` });
  const index = await header.evaluate((element) => element.cellIndex);
  const values = await table
    .locator('tbody tr')
    .evaluateAll(
      (rows, column) =>
        rows.map((row) => Number(row.cells[column]?.textContent ?? '0')),
      index,
    );
  return values.reduce((sum, value) => sum + value, 0);
}

async function driveTeamActivity(
  browser,
  frontendUrl,
  backendUrl,
  evidenceDir,
  studentCookie,
) {
  const kim = fixture.contributions[0];
  const lee = fixture.contributions[1];
  const { context, page } = await openPage(browser, frontendUrl, studentCookie);
  try {
    await page.goto(`${frontendUrl}${PROGRAM_PATH}/team`, {
      waitUntil: 'domcontentloaded',
    });
    const chart = page.locator('[data-slot="team-activity-chart"]');
    await chart.waitFor();
    const table = page.getByRole('table', { name: /주별/ });
    const commitSum = await columnSum(table, 'seed-demo-user-kim-doyoon');
    if (commitSum !== kim.commitCount) {
      throw new Error(
        `chart commit sum for kim-doyoon was ${commitSum}, scaffold is ${kim.commitCount}`,
      );
    }
    await page.getByRole('button', { name: 'PR', exact: true }).click();
    const pullRequestSum = await columnSum(table, 'seed-demo-user-kim-doyoon');
    if (pullRequestSum !== kim.pullRequestCount) {
      throw new Error(
        `chart pull request sum for kim-doyoon was ${pullRequestSum}`,
      );
    }
    await page.getByRole('button', { name: 'Issue', exact: true }).click();
    const issueSum = await columnSum(table, 'seed-demo-user-lee-seojun');
    if (issueSum !== lee.issueCount) {
      throw new Error(`chart issue sum for lee-seojun was ${issueSum}`);
    }
    await page.screenshot({
      path: path.join(evidenceDir, 'chart.png'),
      fullPage: true,
    });
    await saveMain(page, evidenceDir, 'chart.txt');

    const apiUrl = new URL(
      `/api/v1/programs/${encodeURIComponent(PROGRAM_ID)}/teams/${encodeURIComponent(TEAM_ID)}/activity`,
      frontendUrl,
    );
    const response = await page.request.get(apiUrl.toString());
    const body = await response.text();
    writeText(evidenceDir, 'activity-api.json', `${body}\n`);
    if (!response.ok()) {
      throw new Error(`team activity API returned ${response.status()}`);
    }
    const payload = JSON.parse(body);
    const members = payload.members ?? [];
    const kimRow = members.find(
      (member) => member.githubLogin === 'seed-demo-user-kim-doyoon',
    );
    const leeRow = members.find(
      (member) => member.githubLogin === 'seed-demo-user-lee-seojun',
    );
    if (
      payload.status !== 'COLLECTED' ||
      kimRow?.totals?.commitCount !== kim.commitCount ||
      kimRow?.totals?.pullRequestCount !== kim.pullRequestCount ||
      leeRow?.totals?.issueCount !== lee.issueCount
    ) {
      throw new Error('team activity API totals did not match the scaffold');
    }
    writeText(
      evidenceDir,
      'asserted.txt',
      [
        `status=${payload.status}`,
        `seed-demo-user-kim-doyoon commit=${kim.commitCount} pr=${kim.pullRequestCount}`,
        `seed-demo-user-lee-seojun issue=${lee.issueCount}`,
      ].join('\n') + '\n',
    );
    process.stdout.write(
      `team-activity: kim-doyoon commit=${kim.commitCount} pr=${kim.pullRequestCount}\n`,
    );
  } finally {
    await context.close();
  }
}

async function main() {
  const feature = requiredEnv('VERIFY_FEATURE');
  const frontendUrl = requiredEnv('VERIFY_FRONTEND_URL');
  const backendUrl = requiredEnv('VERIFY_BACKEND_URL');
  const evidenceDir = requiredEnv('VERIFY_EVIDENCE_DIR');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const browser = await launchBrowser();
  try {
    if (feature === 'activity-ranking') {
      await driveRanking(browser, frontendUrl, backendUrl, evidenceDir);
      return;
    }
    if (feature === 'team-management') {
      await driveTeamManagement(
        browser,
        frontendUrl,
        backendUrl,
        evidenceDir,
        requiredEnv('VERIFY_STUDENT_COOKIE'),
        requiredEnv('VERIFY_STAFF_COOKIE'),
      );
      return;
    }
    if (feature === 'team-activity') {
      await driveTeamActivity(
        browser,
        frontendUrl,
        backendUrl,
        evidenceDir,
        requiredEnv('VERIFY_STUDENT_COOKIE'),
      );
      return;
    }
    throw new Error(`unknown surface ${feature}`);
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
