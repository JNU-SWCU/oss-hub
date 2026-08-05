import { expect, test } from '@playwright/test';

const programId = 'activity-deep-link';

test('모바일에서 비동기 프로그램 상세의 활동 영역으로 이동한다', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/session') {
      await route.fulfill({
        json: {
          isAuthenticated: true,
          user: {
            nickname: 'qa-staff',
            name: 'QA 교직원',
            email: null,
            avatarUrl: null,
            role: 'STAFF',
          },
        },
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/viewer`) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        json: {
          id: programId,
          name: '활동 이동 확인 프로그램',
          organizer: 'JNU SWCU',
          category: 'BASIC',
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
      await route.fulfill({ json: [] });
      return;
    }
    if (path === '/api/v1/milestones/milestone-1/documents') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: null });
  });

  await page.goto(`/programs/${programId}#activity`);
  const activity = page.locator('#activity');
  await expect(
    activity.getByText('활동 그래프', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      activity.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
      })),
    )
    .toMatchObject({ scrollY: expect.any(Number), viewportHeight: 844 });

  const position = await activity.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
  }));
  expect(position.scrollY).toBeGreaterThan(0);
  expect(position.top).toBeGreaterThanOrEqual(-1);
  expect(position.top).toBeLessThan(position.viewportHeight);

  await context.close();
});
