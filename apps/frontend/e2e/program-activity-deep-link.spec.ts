import { expect, test, type Page } from '@playwright/test';

import { authenticatedSessionBody } from './support/session-mock';
import type {
  ProgramActivity,
  ProgramDetail,
} from '../src/features/programs/types';
import type { ProgramOverview } from '../src/features/programs/program-overview-api';

const programId = 'activity-deep-link';

const activities: readonly ProgramActivity[] = Array.from(
  { length: 6 },
  (_, index) => ({
    applicationId: `application-${index + 1}`,
    label: `참여 저장소 ${index + 1}`,
    commitCount: 12 + index,
    pullRequestCount: 3 + index,
    releaseCount: 1,
    collectionStatus: 'READY',
    members: [],
    hasIncompleteContributions: false,
    dataAsOf: '2026-08-19T00:00:00.000Z',
    lastActivityAt: '2026-08-18T00:00:00.000Z',
  }),
);

async function installProgramRoutes(
  page: Page,
  activityRows: readonly ProgramActivity[] = activities,
): Promise<void> {
  const program: ProgramDetail = {
    id: programId,
    name: '활동 이동 확인 프로그램',
    organizer: 'JNU SWCU',
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'oss-contest',
    lifecycle: 'PUBLISHED',
    repositoryProvisioningEnabled: true,
    description: '비동기 상세 로드 회귀 테스트',
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.000Z',
    },
    viewer: { role: 'STAFF', applicationStatus: null },
    milestones: [
      {
        id: 'milestone-1',
        name: '최종 제출',
        dueAt: '2026-08-10T14:59:59.000Z',
        dDay: 10,
        deadlineLabel: 'D-10',
        description: null,
        submissionType: 'FILE',
        submissionItemCount: 1,
        viewerSubmissionStatus: null,
        applicationSubmissionSummary: {
          notSubmitted: 1,
          submitted: 0,
          approved: 0,
          changesRequested: 0,
          rejected: 0,
          total: 1,
        },
      },
    ],
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== 'GET') {
      throw new Error(`Unexpected activity fixture request: ${method} ${path}`);
    }
    if (path === '/api/v1/auth/session') {
      await route.fulfill({ json: authenticatedSessionBody('staff') });
      return;
    }
    if (path === `/api/v1/programs/${programId}/overview`) {
      await route.fulfill({
        json: {
          programId,
          name: '활동 이동 확인 프로그램',
          trackType: 'EXTRACURRICULAR',
          lifecycle: 'PUBLISHED',
          milestoneCount: 1,
          boardPostCount: 0,
          participantCount: activityRows.length,
          teamCount: activityRows.length,
          connectedRepositoryCount: activityRows.filter(
            (activity) => activity.collectionStatus !== 'NOT_CONNECTED',
          ).length,
          viewerRole: 'STAFF',
          viewerDocumentsCompleted: null,
          viewerDocumentsTotal: null,
          fullySubmittedParticipantCount: 0,
          remainingMilestones: [],
          milestoneDocuments: [],
        } satisfies ProgramOverview,
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/viewer`) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ json: program });
      return;
    }
    if (path === `/api/v1/programs/${programId}`) {
      await route.fulfill({
        json: {
          ...program,
          viewer: { role: null, applicationStatus: null },
          milestones: program.milestones.map((milestone) => ({
            ...milestone,
            applicationSubmissionSummary: null,
          })),
        } satisfies ProgramDetail,
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/activity`) {
      await route.fulfill({ json: activityRows });
      return;
    }
    if (path === '/api/v1/milestones/milestone-1/documents') {
      await route.fulfill({ json: [] });
      return;
    }
    throw new Error(`Unexpected activity fixture request: ${method} ${path}`);
  });
}

async function readActivityAnchor(page: Page) {
  return page.evaluate(() => {
    const target = document.getElementById('activity');
    const scroller = document.getElementById('main-content');
    if (target === null) throw new Error('활동 영역이 렌더되지 않았습니다.');
    if (scroller === null) throw new Error('셸 스크롤 칸이 없습니다.');
    const scrollport = scroller.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,

      offsetFromScrollportTop:
        target.getBoundingClientRect().top - scrollport.top,
      scrollportHeight: scrollport.height,
    };
  });
}

async function openActivityDeepLink(page: Page): Promise<void> {
  await installProgramRoutes(page);
  await page.goto(`/programs/${programId}#activity`);
  const activity = page.locator('#activity');
  await expect(activity.getByText('활동 현황', { exact: true })).toBeVisible();

  await expect(
    activity.getByText('참여 저장소 6', { exact: true }),
  ).toBeVisible();
}

for (const viewport of [
  { name: '모바일', width: 390, height: 844 },
  { name: '데스크톱', width: 1280, height: 900 },
]) {
  test(`${viewport.name}에서 지표 비교와 팀원별 기여를 키보드로 확인한다`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const page = await context.newPage();
    const first = activities[0];
    if (!first) throw new Error('Activity fixture missing');
    const rows: readonly ProgramActivity[] = [
      {
        ...first,
        label: '합성 팀 A',
        commitCount: 40,
        pullRequestCount: 2,
        releaseCount: 0,
        members: [
          {
            githubLogin: 'synthetic-contributor-with-a-long-name',
            commitCount: 40,
            pullRequestCount: 2,
            releaseCount: 0,
          },
          {
            githubLogin: 'synthetic-zero',
            commitCount: 0,
            pullRequestCount: 0,
            releaseCount: 0,
          },
        ],
      },
      {
        ...first,
        applicationId: 'b',
        label: '합성 팀 B',
        commitCount: 20,
        pullRequestCount: 4,
        releaseCount: 1,
        hasIncompleteContributions: true,
        members: [
          {
            githubLogin: 'synthetic-partial',
            commitCount: 10,
            pullRequestCount: 4,
            releaseCount: 1,
          },
        ],
      },
      {
        ...first,
        applicationId: 'empty',
        label: '합성 활동 대기 팀',
        collectionStatus: 'EMPTY',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        members: [],
      },
      {
        ...first,
        applicationId: 'unlinked',
        label: '합성 미연결 팀',
        collectionStatus: 'NOT_CONNECTED',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        members: [],
      },
      {
        ...first,
        applicationId: 'failed',
        label: '합성 수집 실패 팀',
        collectionStatus: 'FAILED',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        members: [],
      },
    ];
    await installProgramRoutes(page, rows);
    await page.goto(`/programs/${programId}#activity`);
    const card = page.locator('section#activity > div[data-slot="card"]');
    await expect(card.getByRole('meter')).toHaveCount(6);
    await expect(
      card
        .getByRole('meter', { name: '합성 팀 B Commit', exact: true })
        .locator('div'),
    ).toHaveAttribute('style', 'width: 50%;');
    const disclosure = card.locator('summary').first();
    const member = card.getByText('@synthetic-zero', { exact: true });
    await expect(member).toBeHidden();
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(member).toBeVisible();
    await expect(
      card.getByText('아직 기여 없음', { exact: true }),
    ).toBeVisible();
    const before = await card
      .getByRole('meter')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-valuenow')),
      );
    await page.screenshot({
      path: testInfo.outputPath('after-desktop-or-mobile.png'),
    });
    await card.screenshot({
      path: testInfo.outputPath('after-activity-element.png'),
    });
    expect(
      await card.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press('Space');
    await expect(member).toBeHidden();
    await page.reload();
    await expect(card.getByRole('meter')).toHaveCount(6);
    expect(
      await card
        .getByRole('meter')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('aria-valuenow')),
        ),
    ).toEqual(before);
    await expect(member).toBeHidden();
    await expect(
      card.getByText('저장소가 연결되지 않았습니다.', { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText('아직 수집된 활동이 없습니다.', { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText('활동 수집에 실패했습니다', { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText('기여도 수집이 온전하지 않습니다', { exact: true }),
    ).toBeVisible();
    await expect(card.locator('summary')).toHaveCount(2);
    await context.close();
  });

  test(`${viewport.name}에서 비동기 프로그램 상세의 활동 영역으로 이동한다`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();

    await openActivityDeepLink(page);

    await expect
      .poll(async () => (await readActivityAnchor(page)).scrollTop)
      .toBeGreaterThan(0);

    const position = await readActivityAnchor(page);
    expect(position.offsetFromScrollportTop).toBeGreaterThanOrEqual(-1);
    expect(position.offsetFromScrollportTop).toBeLessThan(
      position.scrollportHeight,
    );

    await context.close();
  });
}

test('해시 없이 들어오면 활동 영역으로 끌려가지 않는다', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await installProgramRoutes(page);
  await page.goto(`/programs/${programId}`);
  const activity = page.locator('#activity');
  await expect(
    activity.getByText('참여 저장소 6', { exact: true }),
  ).toBeVisible();

  await page.waitForTimeout(1_500);
  expect((await readActivityAnchor(page)).scrollTop).toBe(0);

  await context.close();
});

test('앵커가 붙은 뒤 사용자가 스크롤하면 다시 끌어당기지 않는다', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await openActivityDeepLink(page);
  await expect
    .poll(async () => (await readActivityAnchor(page)).scrollTop)
    .toBeGreaterThan(0);
  const landed = (await readActivityAnchor(page)).scrollTop;

  await page.mouse.move(640, 600);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(600);

  expect((await readActivityAnchor(page)).scrollTop).toBeLessThan(landed - 50);

  await context.close();
});
