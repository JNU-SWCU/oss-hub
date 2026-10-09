import { expect, test, type Locator } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';
import { assertTask9Layout } from './support/member-access-visual';

type ApplicationStatus = 'APPROVED' | 'SUBMITTED' | 'REJECTED';
type SubmissionStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'CHANGES_REQUESTED';
interface Progress {
  readonly approvedCount: number;
  readonly inReviewCount: number;
  readonly totalCount: number;
}

const LONG_REPOSITORY =
  'synthetic-dashboard-repository-with-a-very-long-name-0123456789';
const LONG_ROW_PROGRAM =
  '2026 합성 반려 프로그램 (아주 긴 프로그램 이름이 줄바꿈되는지 확인합니다)';
const NOT_STARTED = {
  repositoryName: null,
  provisionStatus: 'NOT_STARTED',
  invitationStatus: null,
  githubUrl: null,
} as const;

function milestone(
  key: string,
  dueAt: string,
  status: SubmissionStatus,
  remainingItemCount: number,
) {
  return {
    id: `e2e-dashboard-milestone-${key}`,
    name: `합성 ${key} 마일스톤 제출`,
    dueAt,
    submissionStatus: status,
    requiredItemCount: 3,
    remainingItemCount,
  };
}

function item(
  key: string,
  programName: string,
  applicationStatus: ApplicationStatus,
  nextMilestone: ReturnType<typeof milestone> | null,
  repository: object | null,
  progress: Progress | null = null,
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
    progress,
  };
}

const ITEMS = [
  item(
    'reviewing',
    '합성 검토 대기 프로그램',
    'APPROVED',
    milestone('reviewing', '2026-08-21T18:00:00+09:00', 'SUBMITTED', 0),
    NOT_STARTED,
    { approvedCount: 0, inReviewCount: 1, totalCount: 3 },
  ),
  item(
    'resubmit',
    '합성 보완 프로그램',
    'APPROVED',
    milestone('resubmit', '2026-08-28T18:00:00+09:00', 'CHANGES_REQUESTED', 1),
    { ...NOT_STARTED, provisionStatus: 'PROCESSING' },
    { approvedCount: 1, inReviewCount: 0, totalCount: 2 },
  ),
  item(
    'urgent',
    '2026 합성 오픈소스 SW 개발자 대회 (아주 긴 프로그램 이름으로 줄바꿈을 확인합니다)',
    'APPROVED',
    milestone('urgent', '2026-08-22T23:59:00+09:00', 'NOT_SUBMITTED', 3),
    {
      repositoryName: LONG_REPOSITORY,
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'SUCCEEDED',
      githubUrl: `https://github.com/JNU-SWCU/${LONG_REPOSITORY}`,
    },
    { approvedCount: 1, inReviewCount: 0, totalCount: 4 },
  ),
  item(
    'done',
    '합성 마친 프로그램',
    'APPROVED',
    null,
    {
      repositoryName: 'synthetic-done-repo',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'PENDING',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-done-repo',
    },
    { approvedCount: 3, inReviewCount: 0, totalCount: 3 },
  ),
  item('waiting', '합성 신청 대기 프로그램', 'SUBMITTED', null, null),
  item('rejected', LONG_ROW_PROGRAM, 'REJECTED', null, null),
];

function review(
  key: string,
  programKey: string,
  decision: 'APPROVED' | 'CHANGES_REQUESTED',
  itemName: string,
  comment: string | null,
  resubmissionDueAt: string | null,
) {
  const programId = `e2e-dashboard-${programKey}`;
  const milestoneId = `e2e-dashboard-milestone-${programKey}`;
  return {
    id: `e2e-dashboard-review-${key}`,
    decision,
    comment,
    reviewedAt: '2026-08-18T09:00:00+09:00',
    resubmissionDueAt,
    applicationId: `e2e-dashboard-application-${programKey}`,
    programId,
    milestoneId,
    milestoneName: `합성 ${programKey} 마일스톤 제출`,
    itemName,
    href: `/programs/${programId}/documents?milestoneId=${milestoneId}`,
  };
}

const FEEDBACK = [
  review(
    'resubmit',
    'resubmit',
    'CHANGES_REQUESTED',
    '합성 보완 계획서',
    '표지와 목차를 다시 정리하고 근거 자료를 보완해 주세요. '.repeat(4),
    '2026-08-25T23:59:00+09:00',
  ),
  ...['1', '2', '3', '4'].map((index) =>
    review(
      `urgent-${index}`,
      'urgent',
      'APPROVED',
      `합성 서류 ${index}`,
      null,
      null,
    ),
  ),
  review(
    'done',
    'done',
    'APPROVED',
    '합성 최종 보고서',
    '최종 보고서를 승인합니다.',
    null,
  ),
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
      'GET /api/v1/dashboard/student/feedback': async (route) => {
        await fulfillJson(route, { items: FEEDBACK });
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

  const programEntry = (region: Locator, name: string | RegExp) =>
    region.getByRole('listitem').filter({
      has: page.getByRole('heading', { level: 3, name }),
    });
  const card = programEntry(active, /^2026 합성 오픈소스/);
  await expect(card.getByText('서류 3개 남음', { exact: true })).toBeVisible();
  await expect(
    card.getByText('마일스톤 4개 중 승인 1 · 검토 대기 0', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('progressbar', { name: '마일스톤 진행 1/4' }),
  ).toHaveAttribute('value', '1');

  const resubmitCard = programEntry(active, '합성 보완 프로그램');
  const feedbackLink = resubmitCard.getByRole('link', {
    name: '합성 resubmit 마일스톤 제출 · 합성 보완 계획서',
  });
  await expect(
    programEntry(active, '합성 검토 대기 프로그램'),
  ).not.toContainText('새 피드백');
  await expect(resubmitCard.getByText('새 피드백 1건')).toBeVisible();
  await expect(feedbackLink).toHaveAttribute(
    'href',
    '/programs/e2e-dashboard-resubmit/documents?milestoneId=e2e-dashboard-milestone-resubmit',
  );
  await expect(resubmitCard.getByText('재제출 기한 D-5')).toBeVisible();
  const feedbackToggle = card.getByRole('button', { name: /^피드백 / });
  const fourthReview = card.getByRole('link', {
    name: '합성 urgent 마일스톤 제출 · 합성 서류 4',
  });
  await expect(card.getByText('새 피드백 4건')).toBeVisible();
  await expect(card.locator('ul[aria-labelledby] li')).toHaveCount(3);
  await expect(feedbackToggle).toHaveText('피드백 1건 더 보기');
  await expect(feedbackToggle).toHaveAttribute('aria-expanded', 'false');
  await feedbackToggle.focus();
  await page.keyboard.press('Enter');
  await expect(fourthReview).toBeVisible();
  await expect(feedbackToggle).toHaveText('피드백 접기');
  await expect(feedbackToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(feedbackToggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(fourthReview).toHaveCount(0);
  await expect(feedbackToggle).toHaveText('피드백 1건 더 보기');
  await expect(feedbackToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(feedbackToggle).toBeFocused();

  const toggle = done.locator('[aria-controls="dashboard-done-programs"]');
  await expect(toggle).toHaveText('펼치기');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const doneRow = programEntry(done, '합성 마친 프로그램');
  await expect(doneRow).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveText('접기');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(doneRow).toBeVisible();
  await expect(
    done.getByRole('progressbar', { name: '마일스톤 진행 3/3' }),
  ).toBeVisible();
  await expect(done.getByText('승인 3/3', { exact: true })).toBeVisible();
  await expect(done.getByText('새 피드백 1건')).toBeVisible();

  await expect(chips.getByRole('button')).toHaveText([
    '전체 6',
    '진행 중 3',
    '새 피드백 있음 3',
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

  const unclippedTexts = [
    done.getByText('synthetic-done-repo', { exact: true }),
    dashboard.getByRole('heading', { level: 3, name: LONG_ROW_PROGRAM }),
  ];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(card.getByText('D-2', { exact: true })).toBeVisible();
    await assertTask9Layout(page);
    await expectContained(dashboard);
    for (const text of unclippedTexts) {
      await expect(text).toBeVisible();
      expect(
        await text.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }

    const title = await card.getByRole('heading', { level: 3 }).boundingBox();
    const dday = await card.getByText('D-2', { exact: true }).boundingBox();
    const cover = await card
      .locator('[data-slot="program-cover"]')
      .boundingBox();
    const content = await card
      .locator('[data-slot="card-content"]')
      .boundingBox();
    const bar = await card.getByRole('progressbar').boundingBox();
    const summary = await card.getByText(/^마일스톤 4개 중/).boundingBox();
    const link = await feedbackLink.boundingBox();
    const reviewed = await resubmitCard.locator('time').boundingBox();
    if (
      !title ||
      !dday ||
      !cover ||
      !content ||
      !bar ||
      !summary ||
      !link ||
      !reviewed
    )
      throw new Error('카드 배치를 잴 수 없습니다.');
    if (viewport.name === 'phone') {
      expect(dday.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(Math.abs(dday.x - cover.x)).toBeLessThanOrEqual(1);
      expect(bar.y).toBeGreaterThanOrEqual(summary.y + summary.height);
      expect(Math.abs(bar.width - (content.width - 32))).toBeLessThanOrEqual(1);
      expect(reviewed.y).toBeGreaterThanOrEqual(link.y + link.height - 1);
    } else {
      expect(dday.x).toBeGreaterThanOrEqual(title.x + title.width);
      expect(cover.width).toBeCloseTo(176, 0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(summary.x);
      expect(bar.width).toBeCloseTo(220, 0);
      expect(
        Math.abs(reviewed.y + reviewed.height / 2 - (link.y + link.height / 2)),
      ).toBeLessThanOrEqual(6);
    }

    await page.setViewportSize({ width: viewport.width, height: 3200 });
    await dashboard.screenshot({
      path: testInfo.outputPath(`student-dashboard-${viewport.name}.png`),
    });
  }
  audit.assertClean();
});
