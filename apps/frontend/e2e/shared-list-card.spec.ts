import { expect, test, type Page } from '@playwright/test';

// UI 전용 합성 응답으로 카드 레이아웃·탐색만 검증한다. backend 인가 증거가 아니다.
const title =
  '합성 오픈소스 프로젝트의 긴 제목으로 모바일 줄바꿈을 확인합니다 '.repeat(3);
const programId = 'qa170-program';
const projectId = 'qa170-project';
const project = {
  projectId,
  programId,
  programName: '합성 오픈소스 프로그램',
  trackType: 'EXTRACURRICULAR',
  applicationMode: 'TEAM',
  displayName: title,
  repositoryName: 'qa170-synthetic',
  githubUrl: 'https://github.com/JNU-SWCU/qa170-synthetic',
  publishedAt: '2026-09-01T00:00:00.000Z',
};

async function installRoutes(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-15T00:00:00.000Z'));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/session') {
      await route.fulfill({
        json: {
          isAuthenticated: true,
          user: {
            nickname: 'qa170-staff',
            name: null,
            email: null,
            avatarUrl: null,
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: false,
            isProfileComplete: true,
          },
        },
      });
    } else if (path === '/api/v1/programs/status-counts') {
      await route.fulfill({
        json: { all: 1, recruiting: 1, in_progress: 0, upcoming: 0, ended: 0 },
      });
    } else if (path === '/api/v1/programs') {
      await route.fulfill({
        json: {
          items: [
            {
              id: programId,
              name: title,
              organizer: '합성 주관',
              trackType: 'EXTRACURRICULAR',
              lifecycle: 'PUBLISHED',
              applicationStartAt: '2026-01-01T00:00:00.000Z',
              applicationEndAt: '2026-12-31T00:00:00.000Z',
              endAt: null,
              description: '합성 카드 검증',
            },
          ],
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
      });
    } else if (path === '/api/v1/projects/years') {
      await route.fulfill({ json: { years: [2026] } });
    } else if (path === '/api/v1/projects') {
      await route.fulfill({
        json: { items: [project], pageSize: 12, nextPageId: null },
      });
    } else if (path === `/api/v1/projects/${projectId}`) {
      await route.fulfill({
        json: {
          ...project,
          metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
          contributors: [],
        },
      });
    } else if (path === `/api/v1/programs/${programId}/viewer`) {
      await route.fulfill({
        json: {
          id: programId,
          name: title,
          organizer: '합성 주관',
          trackType: 'EXTRACURRICULAR',
          description: '합성 카드 검증',
          applicationPeriod: {
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2026-12-31T00:00:00.000Z',
          },
          viewer: { role: 'STAFF', applicationStatus: null },
          milestones: [],
        },
      });
    } else if (path === `/api/v1/programs/${programId}/overview`) {
      await route.fulfill({
        json: {
          programId,
          name: title,
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
          remainingMilestones: [],
          milestoneDocuments: [],
        },
      });
    } else if (path === `/api/v1/programs/${programId}/activity`) {
      await route.fulfill({ json: [] });
    } else {
      await route.continue();
    }
  });
}

for (const width of [1440, 390]) {
  test(`두 목록은 같은 카드와 한 번의 키보드 초점으로 상세를 연다 (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await installRoutes(page);
    const styles: unknown[] = [];
    for (const [route, slot, detail] of [
      ['/archive', 'list-card', `/archive/${projectId}`],
      ['/programs', 'program-card', `/programs/${programId}`],
    ]) {
      await page.goto(route);
      const card = page.locator(`[data-slot="${slot}"]`).first();
      await expect(card).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      styles.push(
        await card.evaluate((element) => {
          const root = getComputedStyle(element);
          const header = getComputedStyle(
            element.querySelector('[data-slot="card-header"]')!,
          );
          const heading = getComputedStyle(
            element.querySelector('[data-slot="card-title"]')!,
          );
          return {
            radius: root.borderRadius,
            padding: header.paddingLeft,
            fontSize: heading.fontSize,
          };
        }),
      );
      const box = await card.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(width);
      const overflow = await card.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(card.locator('[data-slot="card-title"]')).toContainText(
        title,
      );
      await page.screenshot({
        style: 'nextjs-portal { visibility: hidden; }',
        path: testInfo.outputPath(`qa170-staff-${slot}-${width}.png`),
      });
      await card.screenshot({
        style: 'nextjs-portal { visibility: hidden; }',
        path: testInfo.outputPath(`qa170-staff-${slot}-${width}-element.png`),
      });
      const link = page.locator(`a[href="${detail}"]`).filter({ has: card });
      await expect(link).toHaveCount(1);
      await expect(card.locator('a, button, [tabindex]')).toHaveCount(0);
      // 마우스나 focus() 없이 Tab만으로 카드에 도달한다.
      for (let step = 0; step < 40; step++) {
        await page.keyboard.press('Tab');
        if (
          await link.evaluate((element) => element === document.activeElement)
        )
          break;
      }
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(detail);
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await page.goto(route);
      await card.click();
      await expect(page).toHaveURL(detail);
    }
    expect(styles[0]).toEqual(styles[1]);
  });
}
