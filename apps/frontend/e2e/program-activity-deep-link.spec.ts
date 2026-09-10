import { expect, test, type Page } from '@playwright/test';

import { authenticatedSessionBody } from './support/session-mock';
import type { ProgramActivity } from '../src/features/programs/types';

const programId = 'activity-deep-link';

/**
 * 활동 그래프를 뷰포트보다 길게 만들어 두는 응답. 이 스펙이 잡으려는 결함은
 * "상세가 열린 직후에는 스크롤 칸이 아직 내용보다 크지 않다"는 상태에서만
 * 드러난다 — 활동 그래프는 로딩 중 96px 자리만 차지하다가 데이터가 도착한
 * 뒤에야 자란다.
 */
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
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/session') {
      await route.fulfill({ json: authenticatedSessionBody('staff') });
      return;
    }
    if (path === `/api/v1/programs/${programId}/viewer`) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        json: {
          id: programId,
          name: '활동 이동 확인 프로그램',
          organizer: 'JNU SWCU',
          trackType: 'EXTRACURRICULAR',
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
        },
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
    await route.fulfill({ json: null });
  });
}

/**
 * 프로그램 셸은 `h-dvh overflow-hidden`이라 창 자체는 절대 스크롤되지 않는다.
 * 실제로 움직이는 칸은 `#main-content`이므로(`readProductShellScrollTop`과 같은
 * 원본) 앵커 이동 여부도 그 칸에서 읽는다.
 */
async function readActivityAnchor(page: Page) {
  return page.evaluate(() => {
    const target = document.getElementById('activity');
    const scroller = document.getElementById('main-content');
    if (target === null) throw new Error('활동 영역이 렌더되지 않았습니다.');
    if (scroller === null) throw new Error('셸 스크롤 칸이 없습니다.');
    const scrollport = scroller.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      // 스크롤 칸 위쪽 기준 위치 — `block: 'start'`로 붙으면 0에 수렴한다.
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
  await expect(
    activity.getByText('활동 그래프', { exact: true }),
  ).toBeVisible();
  // 앵커가 늦게 자라는 레이아웃을 따라잡아야 하므로, 마지막 활동 행까지
  // 그려진 뒤에 위치를 읽는다.
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
        .getByRole('meter', { name: '합성 팀 B 커밋', exact: true })
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

  // 레이아웃이 다 앉을 때까지 기다려도 스크롤은 맨 위 그대로여야 한다.
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

  // 앵커가 붙은 직후, 아직 재정렬 창이 열려 있는 동안 사용자가 주도권을 가져간다.
  // 휠은 커서 아래 칸을 굴리므로 본문(`#main-content`) 위로 옮기고 나서 굴린다.
  await page.mouse.move(640, 600);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(600);

  // 사용자가 옮겨 둔 자리를 그대로 두어야 한다 — 손을 떼지 않으면 다음 tick 에
  // 곧바로 앵커로 되돌아온다.
  expect((await readActivityAnchor(page)).scrollTop).toBeLessThan(landed - 50);

  await context.close();
});
