import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import {
  expectProgramChartLayout,
  hideNextDevTools,
  PROGRAM_TICK_SELECTOR,
} from './staff-insights-chart-layout';
import { installBrowserAudit } from './support/browser-audit';
import { CONSENTED_RESPONSE } from './support/member-access-fixture';
import { authenticatedSessionBody } from './support/session-mock';

const target = '/dashboard/insights';
const staffSession = authenticatedSessionBody('staff');

interface InsightsMetricsWire {
  readonly studentCount: number;
  readonly activeStudentCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
  readonly participantCount: number;
}

interface InsightsCohortWire extends InsightsMetricsWire {
  readonly cohort: 'sw-major' | 'non-sw' | 'unregistered';
}

interface InsightsDepartmentWire extends InsightsMetricsWire {
  readonly department: string;
  readonly cohort: InsightsCohortWire['cohort'];
  readonly activityPerStudent: number;
  readonly sampleTooSmall: boolean;
}

interface InsightsRecentLeaderWire {
  readonly rank: number;
  readonly name: string | null;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly cohort: InsightsCohortWire['cohort'];
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly total: number;
}

interface InsightsPeriodLeaderWire extends InsightsRecentLeaderWire {
  readonly starCount: number;
}

interface InsightsLeadersByCohortWire<Row> {
  readonly all: readonly Row[];
  readonly swMajor: readonly Row[];
  readonly nonSw: readonly Row[];
}

interface InsightsProgramWire {
  readonly programId: string;
  readonly name: string;
  readonly swMajorCount: number;
  readonly nonSwCount: number;
  readonly unregisteredCount: number;
  readonly participantCount: number;
}

interface InsightsWire {
  readonly scope: { readonly kind: 'all' };
  readonly dataAsOf: string | null;
  readonly years: readonly number[];
  readonly cohorts: readonly InsightsCohortWire[];
  readonly departments: readonly InsightsDepartmentWire[];
  readonly programs: readonly InsightsProgramWire[];
  readonly leaders: {
    readonly period: InsightsLeadersByCohortWire<InsightsPeriodLeaderWire>;
    readonly recent: InsightsLeadersByCohortWire<InsightsRecentLeaderWire>;
  };
  readonly recentWindow: { readonly from: string; readonly to: string };
}

const EMPTY_METRICS: InsightsMetricsWire = {
  studentCount: 0,
  activeStudentCount: 0,
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
  total: 0,
  participantCount: 0,
};

const LONG_PROGRAM_NAMES = [
  '프로그램 1 — 전공·비전공 오픈소스 협업 기초 과정',
  '프로그램 2 — 지역 문제 해결형 공개 소프트웨어 실습',
  '프로그램 3 — 학과 연합 GitHub 프로젝트 집중 과정',
  '프로그램 4 — 오픈소스 기여자 성장 지원 프로그램',
  '프로그램 5 — 산학 협력 소프트웨어 개발 프로젝트',
  '프로그램 6 — 전공 융합 공개 저장소 운영 실습',
  '프로그램 7 — 학생 주도 커뮤니티 기여 챌린지',
  '프로그램 8 — 캡스톤 오픈소스 성과 공유 과정',
  '프로그램 👩‍💻 9 — 긴 이름 협업 실습',
  '프로그램 10 — 경계👩‍💻 유니코드 절단 회귀 과정',
  '프로그램 11 — 지역 연계 공개 소프트웨어 집중 과정',
  '프로그램 12 — 다학제 팀 프로젝트 성과 공유회',
] as const;

const NO_LEADERS: InsightsWire['leaders'] = {
  period: { all: [], swMajor: [], nonSw: [] },
  recent: { all: [], swMajor: [], nonSw: [] },
};

function leaderRow(rank: number): InsightsRecentLeaderWire {
  return {
    rank,
    name: `합성 학생 ${rank}`,
    githubLogin: `synthetic-${rank}`,
    department: '소프트웨어공학과',
    cohort: 'sw-major',
    commitCount: 30 - rank,
    pullRequestCount: 6,
    issueCount: 2,
    repositoryCount: 1,
    total: 39 - rank,
  };
}

function leaderRows(): InsightsRecentLeaderWire[] {
  return [1, 2, 3].map(leaderRow);
}

function periodLeaderRows(): InsightsPeriodLeaderWire[] {
  return leaderRows().map((row) => ({
    ...row,
    starCount: 5,
    total: row.total + 5,
  }));
}

function insightsEnvelope(
  overrides: Pick<InsightsWire, 'cohorts' | 'departments' | 'programs'> &
    Partial<Pick<InsightsWire, 'leaders'>>,
): InsightsWire {
  return {
    scope: { kind: 'all' },
    dataAsOf: '2026-08-01T00:00:00.000Z',
    years: [2026],
    leaders: NO_LEADERS,
    recentWindow: {
      from: '2026-07-02T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function insightsLong(): InsightsWire {
  return insightsEnvelope({
    cohorts: [],
    departments: [],
    leaders: {
      period: {
        all: periodLeaderRows(),
        swMajor: periodLeaderRows(),
        nonSw: periodLeaderRows(),
      },
      recent: {
        all: leaderRows(),
        swMajor: leaderRows(),
        nonSw: leaderRows(),
      },
    },
    programs: LONG_PROGRAM_NAMES.map((name, index) => ({
      programId: `program-long-${index + 1}`,
      name,
      swMajorCount: index + 1,
      nonSwCount: index,
      unregisteredCount: index % 2,
      participantCount: index * 2 + 1 + (index % 2),
    })),
  });
}

function insightsZero(): InsightsWire {
  return insightsEnvelope({
    cohorts: [
      { cohort: 'sw-major', ...EMPTY_METRICS },
      { cohort: 'non-sw', ...EMPTY_METRICS },
      { cohort: 'unregistered', ...EMPTY_METRICS },
    ],
    departments: [],
    programs: [],
  });
}

function insightsEmpty(): InsightsWire {
  return insightsEnvelope({
    cohorts: [],
    departments: [],
    programs: [],
  });
}

function insightsUnregistered(): InsightsWire {
  return insightsEnvelope({
    cohorts: [
      {
        cohort: 'unregistered',
        studentCount: 3,
        activeStudentCount: 0,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
        participantCount: 1,
      },
    ],
    departments: [
      {
        department: '미등록',
        cohort: 'unregistered',
        activityPerStudent: 0,
        sampleTooSmall: false,
        studentCount: 3,
        activeStudentCount: 0,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
        participantCount: 1,
      },
    ],
    programs: [
      {
        programId: 'program-unregistered-only',
        name: '합성 기초 오픈소스 스터디',
        swMajorCount: 0,
        nonSwCount: 0,
        unregisteredCount: 2,
        participantCount: 2,
      },
    ],
  });
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function rejectUnexpectedApi(route: Route): never {
  const request = route.request();
  const url = new URL(request.url());
  throw new Error(
    `Unexpected intercepted API request: ${request.method()} ${url.pathname}${url.search}`,
  );
}

async function openInsights(
  page: Page,
  insights: InsightsWire,
  view?: 'groups' | 'programs',
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/auth/session') {
      if (url.search !== '') {
        rejectUnexpectedApi(route);
      }
      await fulfillJson(route, staffSession);
      return;
    }
    if (
      request.method() === 'GET' &&
      url.pathname === '/api/v1/consents/current'
    ) {
      if (url.search !== '') {
        rejectUnexpectedApi(route);
      }
      await fulfillJson(route, CONSENTED_RESPONSE);
      return;
    }
    if (
      request.method() === 'GET' &&
      url.pathname === '/api/v1/dashboard/staff/insights'
    ) {
      if (url.search !== '') {
        rejectUnexpectedApi(route);
      }
      await fulfillJson(route, insights);
      return;
    }
    rejectUnexpectedApi(route);
  });
  await page.goto(view === undefined ? target : `${target}?view=${view}`);
  await expect(page.getByRole('heading', { name: '인사이트' })).toBeVisible();
}

function countInsightsRequests(page: Page): { readonly count: () => number } {
  let count = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname === '/api/v1/dashboard/staff/insights'
    ) {
      count += 1;
    }
  });
  return { count: () => count };
}

function leaderCard(page: Page, title: string): Locator {
  return page
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::*[@data-slot="card"][1]');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function attachPng(
  testInfo: TestInfo,
  name: string,
  screenshot: (path: string) => Promise<unknown>,
): Promise<void> {
  const imagePath = testInfo.outputPath(...name.split('/'));
  await screenshot(imagePath);
  await testInfo.attach(name, { path: imagePath, contentType: 'image/png' });
}

test.describe('staff insights comparison UX', () => {
  test('keeps dense program labels separate at responsive widths', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    for (const [name, width] of [
      ['desktop', 1280],
      ['tablet', 768],
      ['mobile', 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await openInsights(page, insightsLong(), 'programs');
      await hideNextDevTools(page);
      const card = page
        .getByText('프로그램 참여 순위', { exact: true })
        .locator('xpath=ancestor::*[@data-slot="card"][1]');

      await card.scrollIntoViewIfNeeded();
      const chartViewport = card.locator(
        '[data-slot="participation-chart-viewport"]',
      );

      await expectProgramChartLayout(page);
      const baseProgramLabelFontSize = await page
        .locator(PROGRAM_TICK_SELECTOR)
        .filter({ hasText: '프로그램' })
        .first()
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        );
      const scrollBounds = await chartViewport.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(scrollBounds.clientHeight).toBeLessThanOrEqual(560);
      expect(scrollBounds.scrollHeight).toBeGreaterThan(
        scrollBounds.clientHeight,
      );
      await expect(
        card.locator('[data-slot="participation-chart-legend"]'),
      ).toHaveText(/SW전공.*비SW전공.*학과 미등록/);
      await expect(card).toContainText('기간 필터는 적용되지 않습니다.');
      await expect(
        card.locator('[data-slot="participation-chart-scroll-hint"]'),
      ).toBeVisible();
      await expect(chartViewport).toHaveAttribute('role', 'region');
      await expect(chartViewport).toHaveAttribute(
        'aria-label',
        '프로그램별 참여 차트',
      );
      await expect(chartViewport).toHaveAttribute(
        'aria-describedby',
        'participation-chart-scroll-hint',
      );
      await page.mouse.move(0, 0);
      await attachPng(
        testInfo,
        `participation-program-labels/${name}.png`,
        (path) => card.screenshot({ path }),
      );
      const keyboardScroll = chartViewport.evaluate(
        (element) =>
          new Promise<number>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              reject(new Error('키보드 스크롤 이벤트가 발생하지 않았습니다.'));
            }, 2_000);
            element.addEventListener(
              'scrollend',
              () => {
                window.clearTimeout(timeout);
                resolve(element.scrollTop);
              },
              { once: true },
            );
          }),
      );
      await chartViewport.press('PageDown');
      await expect(chartViewport).toBeFocused();
      expect(await keyboardScroll).toBeGreaterThan(0);
      await chartViewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(
        await chartViewport.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).not.toBe('none');
      expect(
        await chartViewport.evaluate(
          (element) => getComputedStyle(element).outlineWidth,
        ),
      ).not.toBe('0px');
      const lastTickBounds = await page
        .locator(PROGRAM_TICK_SELECTOR)
        .filter({ hasText: '프로그램 12' })
        .boundingBox();
      const viewportBounds = await chartViewport.boundingBox();
      if (lastTickBounds === null || viewportBounds === null) {
        throw new Error('차트와 마지막 프로그램의 화면 경계가 필요합니다.');
      }
      expect(lastTickBounds.y).toBeGreaterThanOrEqual(viewportBounds.y);
      expect(lastTickBounds.y + lastTickBounds.height).toBeLessThanOrEqual(
        viewportBounds.y + viewportBounds.height + 2,
      );
      await page.mouse.move(0, 0);
      await attachPng(
        testInfo,
        `participation-program-labels/${name}-scrolled.png`,
        (path) => chartViewport.screenshot({ path }),
      );
      await chartViewport.evaluate((element) => {
        element.scrollTop = 0;
      });
      expect(
        await chartViewport.evaluate((element) => element.scrollTop),
      ).toBeLessThanOrEqual(1);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expectProgramChartLayout(page);
      expect(
        await page
          .locator(PROGRAM_TICK_SELECTOR)
          .filter({ hasText: '프로그램' })
          .first()
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
      ).toBeGreaterThanOrEqual(baseProgramLabelFontSize * 1.9);
      await page.mouse.move(0, 0);
      await attachPng(
        testInfo,
        `participation-program-labels/${name}-200-text.png`,
        (path) => card.screenshot({ path }),
      );
    }
    audit.assertClean();
  });

  test('keeps dense program labels separate with pending 200% text resize delivery', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.addInitScript(() => {
      const NativeResizeObserver = window.ResizeObserver;
      const deferredDeliveryMs = 250;
      class DeferredResizeObserver extends NativeResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super((entries, observer) => {
            if (document.documentElement.style.fontSize === '200%') {
              window.setTimeout(() => {
                callback(entries, observer);
              }, deferredDeliveryMs);
              return;
            }
            callback(entries, observer);
          });
        }
      }
      window.ResizeObserver = DeferredResizeObserver;
    });
    await openInsights(page, insightsLong(), 'programs');
    await hideNextDevTools(page);
    const card = page
      .getByText('프로그램 참여 순위', { exact: true })
      .locator('xpath=ancestor::*[@data-slot="card"][1]');
    await card.scrollIntoViewIfNeeded();
    await expectProgramChartLayout(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expectProgramChartLayout(page);
    await page.mouse.move(0, 0);
    await attachPng(
      testInfo,
      'participation-program-labels/mobile-pending-resize-200-text.png',
      (path) => card.screenshot({ path }),
    );
    audit.assertClean();
  });

  test('renders long Korean labels at desktop and mobile with keyboard and 200% text', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await openInsights(page, insightsLong(), 'programs');
      await page.keyboard.press('Tab');
      await expect(
        page
          .getByRole('cell', {
            name: '프로그램 1 — 전공·비전공 오픈소스 협업 기초 과정',
          })
          .first(),
      ).toBeVisible();
      await expectProgramChartLayout(page);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expectProgramChartLayout(page);
      await expect(
        page.getByRole('group', { name: '인사이트 보기' }),
      ).toBeVisible();
      await attachPng(
        testInfo,
        `task-2-browser/${name}-long-200-text.png`,
        (path) => page.screenshot({ path, fullPage: true }),
      );
    }
    audit.assertClean();
  });

  test('shows keyboard-only focus indicators without mouse emphasis', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await openInsights(page, insightsLong());
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });

      for (const label of ['학생', '학과·전공', '프로그램'] as const) {
        const button = page
          .getByRole('group', { name: '인사이트 보기' })
          .getByRole('link', { name: label, exact: true });
        await button.click();
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
        const mouseFocusVisible = await button.evaluate((element) =>
          element.matches(':focus-visible'),
        );
        await button.focus();
        await expect
          .poll(() =>
            button.evaluate((element) => {
              const style = getComputedStyle(element);
              const hasVisibleOutline =
                style.outlineWidth !== '0px' &&
                style.outlineColor !== 'rgba(0, 0, 0, 0)';
              const hasVisibleShadow = style.boxShadow !== 'none';
              return {
                visible: hasVisibleOutline || hasVisibleShadow,
              };
            }),
          )
          .toMatchObject({ visible: true });
        expect(mouseFocusVisible).toBe(false);
      }
      await attachPng(
        testInfo,
        `focus-visible-fix/${name}-200-focus-visible.png`,
        (path) => page.screenshot({ path, fullPage: true }),
      );
    }
    audit.assertClean();
  });

  test('shows period and recent top-10 cards on the default students tab', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    const insightsRequests = countInsightsRequests(page);
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 390],
    ] as const) {
      const before = insightsRequests.count();
      await page.setViewportSize({ width, height: 1000 });
      await openInsights(page, insightsLong());
      const period = leaderCard(page, '기간 전체 상위 10명');
      const recent = leaderCard(page, '최근 30일 상위 10명');
      for (const card of [period, recent]) {
        await expect(card).toBeVisible();
        await expect(card.getByRole('listitem')).toHaveText([
          /^1합성 학생 1.*@synthetic-1/,
          /^2합성 학생 2.*@synthetic-2/,
          /^3합성 학생 3.*@synthetic-3/,
        ]);
      }
      await expect(period.getByRole('listitem').first()).toContainText('43');
      await expect(recent.getByRole('listitem').first()).toContainText('38');
      await expect(recent).toContainText('Star 제외');
      const loaded = insightsRequests.count();
      expect(loaded).toBeGreaterThan(before);

      const periodBox = await period.boundingBox();
      const recentBox = await recent.boundingBox();
      if (periodBox === null || recentBox === null) {
        throw new Error('두 순위 카드의 화면 경계가 필요합니다.');
      }
      if (name === 'desktop') {
        expect(Math.abs(periodBox.y - recentBox.y)).toBeLessThanOrEqual(1);
        expect(recentBox.x).toBeGreaterThanOrEqual(
          periodBox.x + periodBox.width,
        );
      } else {
        expect(recentBox.y).toBeGreaterThanOrEqual(
          periodBox.y + periodBox.height,
        );
      }
      await expectNoHorizontalOverflow(page);
      await page.mouse.move(0, 0);
      await attachPng(testInfo, `students-leaderboard/${name}.png`, (path) =>
        page.screenshot({ path, fullPage: true }),
      );

      const swChip = page
        .getByRole('group', { name: '학생 구분' })
        .getByRole('button', { name: 'SW전공', exact: true });
      await swChip.click();
      await expect(swChip).toHaveAttribute('aria-pressed', 'true');
      await expect(period.getByRole('listitem')).toHaveCount(3);
      expect(insightsRequests.count()).toBe(loaded);
    }
    audit.assertClean();
  });

  test('keeps long Korean leader names inside the card at mobile width', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    const longName =
      '아주긴이름을가진합성학생오픈소스기여자가나다라마바사아자차카타파하';
    const longDepartment =
      '전자컴퓨터공학부(컴퓨터공학전공) 융합소프트웨어연계전공';
    const base = insightsLong();
    const period = periodLeaderRows().map((row, index) =>
      index === 0
        ? { ...row, name: longName, department: longDepartment }
        : row,
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await openInsights(page, {
      ...base,
      leaders: {
        ...base.leaders,
        period: { all: period, swMajor: period, nonSw: period },
      },
    });
    const card = leaderCard(page, '기간 전체 상위 10명');
    const name = card.getByText(longName, { exact: true });
    await expect(name).toBeVisible();
    const nameBox = await name.boundingBox();
    const cardBox = await card.boundingBox();
    if (nameBox === null || cardBox === null) {
      throw new Error('긴 이름과 카드의 화면 경계가 필요합니다.');
    }
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width,
    );
    await expect(card.getByRole('listitem').first()).toContainText('43');
    await expectNoHorizontalOverflow(page);
    await attachPng(
      testInfo,
      'students-leaderboard/mobile-long-name.png',
      (path) => card.screenshot({ path }),
    );
    audit.assertClean();
  });

  test('renders both leaderboard empty states', async ({ page }, testInfo) => {
    const audit = installBrowserAudit(page);
    await openInsights(page, insightsEmpty());
    await expect(
      page.getByText('이 기간에 활동한 학생이 없습니다', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('최근 30일에 늘어난 활동이 없습니다', { exact: true }),
    ).toBeVisible();
    await attachPng(testInfo, 'students-leaderboard/empty.png', (path) =>
      page.screenshot({ path, fullPage: true }),
    );
    audit.assertClean();
  });

  test('renders all-zero state without divide-by-zero output', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await openInsights(page, insightsZero(), 'groups');
    await expect(page.getByText(/계산 불가|0\/0/).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText('NaN');
    await attachPng(testInfo, 'task-2-browser/all-zero.png', (path) =>
      page.screenshot({ path, fullPage: true }),
    );
    audit.assertClean();
  });

  test('renders the programs empty state', async ({ page }, testInfo) => {
    const audit = installBrowserAudit(page);
    await openInsights(page, insightsEmpty(), 'programs');
    await expect(page.getByText('승인된 참여가 없습니다')).toBeVisible();
    await attachPng(testInfo, 'task-2-browser/empty-programs.png', (path) =>
      page.screenshot({ path, fullPage: true }),
    );
    audit.assertClean();
  });

  test('renders the department empty state', async ({ page }, testInfo) => {
    const audit = installBrowserAudit(page);
    await openInsights(page, insightsEmpty(), 'groups');
    await expect(page.getByText('학과별 학생이 없습니다')).toBeVisible();
    await attachPng(testInfo, 'task-2-browser/empty-groups.png', (path) =>
      page.screenshot({ path, fullPage: true }),
    );
    audit.assertClean();
  });

  test('renders unregistered disclosure and semantic parity', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openInsights(page, insightsUnregistered(), 'groups');
    await expect(
      page.getByText(/학과 미등록은 별도로 집계하며 아래 비교 막대에서는 제외/),
    ).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'SW전공과 비SW전공의 랭킹 지표' }),
    ).toBeAttached();
    const legend = page.locator('.recharts-legend-wrapper');
    await expect(legend.getByText('SW전공', { exact: true })).toBeVisible();
    await expect(legend.getByText('비SW전공', { exact: true })).toBeVisible();
    await expect(page.locator('main')).toContainText('x/0');
    await attachPng(testInfo, 'task-2-browser/unregistered-only.png', (path) =>
      page.screenshot({ path, fullPage: true }),
    );
    audit.assertClean();
  });
});
