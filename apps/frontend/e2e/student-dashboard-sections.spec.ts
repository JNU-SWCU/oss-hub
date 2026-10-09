import { expect, test, type Locator } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';
import { assertTask9Layout } from './support/member-access-visual';

type ApplicationStatus = 'APPROVED' | 'SUBMITTED' | 'REJECTED';
type SubmissionStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'CHANGES_REQUESTED';

const LONG_REPOSITORY =
  'synthetic-dashboard-repository-with-a-very-long-name-0123456789';
const NOT_STARTED = {
  repositoryName: null,
  provisionStatus: 'NOT_STARTED',
  invitationStatus: null,
  githubUrl: null,
} as const;

function milestone(key: string, dueAt: string, status: SubmissionStatus) {
  return {
    id: `e2e-dashboard-milestone-${key}`,
    name: `합성 ${key} 마일스톤 제출`,
    dueAt,
    submissionStatus: status,
  };
}

function item(
  key: string,
  programName: string,
  applicationStatus: ApplicationStatus,
  nextMilestone: ReturnType<typeof milestone> | null,
  repository: object | null,
) {
  const programPath = `/programs/e2e-dashboard-${key}`;
  return {
    coverImageUrl: null,
    applicationId: `e2e-dashboard-application-${key}`,
    programId: `e2e-dashboard-${key}`,
    programName,
    teamName: `합성 ${key} 팀`,
    teamUrl: `${programPath}/my-team`,
    applicationStatus,
    nextMilestone,
    detailUrl:
      applicationStatus === 'APPROVED' ? programPath : `${programPath}/apply`,
    checklistUrl: `${programPath}/submissions`,
    repository,
  };
}

const ITEMS = [
  item(
    'reviewing',
    '합성 검토 대기 프로그램',
    'APPROVED',
    milestone('reviewing', '2026-08-21T18:00:00+09:00', 'SUBMITTED'),
    NOT_STARTED,
  ),
  item(
    'resubmit',
    '합성 보완 프로그램',
    'APPROVED',
    milestone('resubmit', '2026-08-28T18:00:00+09:00', 'CHANGES_REQUESTED'),
    { ...NOT_STARTED, provisionStatus: 'PROCESSING' },
  ),
  item(
    'urgent',
    '2026 합성 오픈소스 SW 개발자 대회 (아주 긴 프로그램 이름으로 줄바꿈을 확인합니다)',
    'APPROVED',
    milestone('urgent', '2026-08-22T23:59:00+09:00', 'NOT_SUBMITTED'),
    {
      repositoryName: LONG_REPOSITORY,
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'SUCCEEDED',
      githubUrl: `https://github.com/JNU-SWCU/${LONG_REPOSITORY}`,
    },
  ),
  item('done', '합성 마친 프로그램', 'APPROVED', null, {
    repositoryName: 'synthetic-done-repo',
    provisionStatus: 'SUCCEEDED',
    invitationStatus: 'PENDING',
    githubUrl: 'https://github.com/JNU-SWCU/synthetic-done-repo',
  }),
  item('waiting', '합성 신청 대기 프로그램', 'SUBMITTED', null, null),
  item('rejected', '합성 반려 프로그램', 'REJECTED', null, null),
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

async function expectContained(dashboard: Locator): Promise<void> {
  const result = await dashboard.evaluate((root) => {
    const escaped: string[] = [];
    for (const element of root.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const frame =
        element.parentElement?.closest(
          '[data-slot="card"], [data-slot="list-row"]',
        ) ?? root;
      const bounds = frame.getBoundingClientRect();
      if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) {
        escaped.push(
          `${element.tagName} ${element.textContent?.trim().slice(0, 30)}`,
        );
      }
    }
    const scrollers = [
      document.documentElement,
      document.getElementById('main-content'),
    ].filter(
      (scroller): scroller is HTMLElement =>
        scroller !== null && scroller.scrollWidth > scroller.clientWidth + 1,
    );
    return { escaped, scrolling: scrollers.map((scroller) => scroller.id) };
  });

  expect(result).toEqual({ escaped: [], scrolling: [] });
}

test('학생 대시보드는 묶음·주 행동·접기·거르기를 넓은 화면과 휴대폰 폭에서 지킨다', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await page.clock.setFixedTime(new Date('2026-08-20T10:00:00+09:00'));
  await installSyntheticAuthority(
    page,
    {
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    {
      'GET /api/v1/dashboard/student': async (route) => {
        await fulfillJson(route, { items: ITEMS });
      },
      'GET /api/v1/users/me/notifications/application-decisions': async (
        route,
      ) => {
        await fulfillJson(route, []);
      },
      'GET /api/v1/team-invitations/received': async (route) => {
        await fulfillJson(route, []);
      },
    },
  );
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/dashboard');

  const dashboard = page.locator('main').filter({
    has: page.getByRole('heading', { level: 1, name: '내 대시보드' }),
  });
  const sections = dashboard.getByRole('heading', { level: 2 });
  const active = dashboard.getByRole('region', { name: '진행 중' });
  const done = dashboard.getByRole('region', { name: '마친 프로그램' });
  const chips = dashboard.getByRole('group', { name: '프로그램 거르기' });

  await expect(sections).toHaveText(['진행 중', '마친 프로그램', '신청 상태']);
  await expect(active.getByRole('heading', { level: 3 })).toHaveText([
    '합성 검토 대기 프로그램',
    /^2026 합성 오픈소스/,
    '합성 보완 프로그램',
  ]);
  await expect(dashboard.locator('[data-variant="default"]')).toHaveCount(1);
  await expect(
    active.getByRole('link', { name: '서류 내기', exact: true }),
  ).toHaveAttribute('data-variant', 'default');
  await expect(
    active.getByRole('link', { name: '다시 내기', exact: true }),
  ).toHaveAttribute('data-variant', 'outline');

  const toggle = done.locator('[aria-controls="dashboard-done-programs"]');
  await expect(toggle).toHaveText('펼치기');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(done.getByRole('listitem')).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveText('접기');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(done.getByRole('listitem')).toBeVisible();

  await expect(chips.getByRole('button')).toHaveText([
    '전체 6',
    '진행 중 3',
    '마친 프로그램 1',
    '신청 상태 2',
  ]);
  await chips.getByRole('button', { name: '전체 6' }).focus();
  await page.keyboard.press('End');
  await expect(
    chips.getByRole('button', { name: '신청 상태 2' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sections).toHaveText(['신청 상태']);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(sections).toHaveText(['진행 중', '마친 프로그램', '신청 상태']);

  const card = active.getByRole('listitem').nth(1);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(card.getByText('D-2', { exact: true })).toBeVisible();
    await assertTask9Layout(page);
    await expectContained(dashboard);

    const title = await card.getByRole('heading', { level: 3 }).boundingBox();
    const dday = await card.getByText('D-2', { exact: true }).boundingBox();
    const cover = await card
      .locator('[data-slot="program-cover"]')
      .boundingBox();
    if (!title || !dday || !cover)
      throw new Error('카드 배치를 잴 수 없습니다.');
    if (viewport.name === 'phone') {
      expect(dday.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(Math.abs(dday.x - cover.x)).toBeLessThanOrEqual(1);
    } else {
      expect(dday.x).toBeGreaterThanOrEqual(title.x + title.width);
      expect(cover.width).toBeCloseTo(176, 0);
    }

    await page.setViewportSize({ width: viewport.width, height: 3200 });
    await dashboard.screenshot({
      path: testInfo.outputPath(`student-dashboard-${viewport.name}.png`),
    });
  }
  audit.assertClean();
});
