import { expect, test } from '@playwright/test';

const programId = 'ended-card-detail';

// 종료된 프로그램도 카드를 클릭하면 상세로 이동해야 한다 — 백엔드는 ARCHIVED/종료
// 프로그램의 상세 읽기를 이미 허용한다(programs.service.ts detail() 주석 참고).
// 프런트가 openable을 status==='ended'로 막았던 회귀를 잡는다.
test('종료된 프로그램 카드를 클릭하면 상세 페이지가 정상 렌더된다', async ({
  page,
}) => {
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
    if (path === '/api/v1/programs/status-counts') {
      await route.fulfill({
        json: {
          all: 1,
          recruiting: 0,
          in_progress: 0,
          upcoming: 0,
          ended: 1,
        },
      });
      return;
    }
    if (path === '/api/v1/programs') {
      await route.fulfill({
        json: {
          items: [
            {
              id: programId,
              name: '종료된 오픈소스 기여 프로그램',
              organizer: 'JNU SWCU',
              trackType: 'EXTRACURRICULAR',
              lifecycle: 'PUBLISHED',
              applicationStartAt: '2026-01-01T00:00:00.000Z',
              applicationEndAt: '2026-01-31T00:00:00.000Z',
              endAt: '2026-02-28T00:00:00.000Z',
              description: '종료된 프로그램 카드 클릭 회귀 테스트',
            },
          ],
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/viewer`) {
      await route.fulfill({
        json: {
          id: programId,
          name: '종료된 오픈소스 기여 프로그램',
          organizer: 'JNU SWCU',
          trackType: 'EXTRACURRICULAR',
          description: '종료된 프로그램 카드 클릭 회귀 테스트',
          applicationPeriod: {
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2026-01-31T00:00:00.000Z',
          },
          viewer: { role: 'STAFF', applicationStatus: null },
          milestones: [],
        },
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/overview`) {
      await route.fulfill({
        json: {
          programId,
          name: '종료된 오픈소스 기여 프로그램',
          trackType: 'EXTRACURRICULAR',
          lifecycle: 'PUBLISHED',
          milestoneCount: 0,
          boardPostCount: 0,
          participantCount: 0,
          teamCount: 0,
          connectedRepositoryCount: 0,
          viewerRole: 'STAFF',
          viewerDocumentsCompleted: null,
          viewerDocumentsTotal: null,
          fullySubmittedParticipantCount: 0,
          nextMilestone: null,
          milestoneDocuments: [],
        },
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/activity`) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: null });
  });

  await page.goto('/programs');

  const card = page.locator('[data-slot="program-card"][data-status="ended"]');
  await expect(card).toBeVisible();
  await expect(card.getByText('자세히 ›')).toBeVisible();

  await card.click();

  await expect(page).toHaveURL(`/programs/${programId}`);
  await expect(
    page.getByRole('heading', { name: '종료된 오픈소스 기여 프로그램' }),
  ).toBeVisible();
});
