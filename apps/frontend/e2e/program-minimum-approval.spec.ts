import { expect, test } from '@playwright/test';
import type { ProgramDetail } from '../src/features/programs/catalog/dto';
import type {
  ApplicationListItem,
  TeamManagementListItem,
} from '../src/features/programs/applications/dto';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

const programId = 'synthetic-minimum';
const program: ProgramDetail = {
  teamMinSize: 2,
  teamMaxSize: 3,
  id: programId,
  name: '합성 팀 프로그램',
  organizers: ['합성 운영처'],
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  description: '',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-08-01T00:00:00Z',
    endsAt: '2026-08-31T00:00:00Z',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};
const row: TeamManagementListItem = {
  teamMinSize: 2,
  teamMaxSize: 3,
  id: 'synthetic-minimum-application',
  status: 'SUBMITTED',
  submittedAt: '2026-08-15T00:00:00Z',
  applicant: {
    name: '합성 신청자',
    nickname: 'synthetic-applicant',
  },
  team: {
    id: 'synthetic-minimum-team',
    name: '합성 지원 팀',
    memberCount: 1,
    members: [
      {
        name: '합성 신청자',
        nickname: 'synthetic-applicant',
      },
    ],
  },
};
const application: ApplicationListItem = {
  status: row.status,
  rejectionReason: null,
  applicant: row.applicant,
};

for (const width of [1440, 390]) {
  test(`staff sees minimum-size approval refusal at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
    await installSyntheticAuthority(
      page,
      {
        role: 'STAFF',
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: false,
      },
      {
        'GET /api/v1/consents/current': (route) =>
          fulfillJson(route, {
            policyVersion: '2026-11-01',
            requiredItems: [
              {
                key: 'privacy',
                label: '개인정보 수집·이용',
                documentUrl: '/policies/privacy',
              },
            ],
            acceptedPolicyVersion: '2026-11-01',
            consented: true,
            nextUrl: '/dashboard',
          }),
        'GET /api/v1/team-invitations/received': (route) =>
          fulfillJson(route, []),
        [`GET /api/v1/programs/${programId}`]: (route) =>
          fulfillJson(route, program),
        [`GET /api/v1/programs/${programId}/viewer`]: (route) =>
          fulfillJson(route, program),
        [`GET /api/v1/programs/${programId}/overview`]: (route) =>
          fulfillJson(route, {
            programId,
            name: program.name,
            trackType: 'EXTRACURRICULAR',
            milestoneCount: 0,
            boardPostCount: 0,
            participantCount: 1,
            teamCount: 1,
            connectedRepositoryCount: 0,
            viewerRole: 'STAFF',
            viewerDocumentsCompleted: null,
            viewerDocumentsTotal: null,
            fullySubmittedParticipantCount: 0,
            scheduleMilestones: [],
            requirements: [],
          }),
        [`GET /api/v1/programs/${programId}/teams`]: (route) =>
          fulfillJson(route, {
            items: [row],
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalPages: 1,
          }),
        [`GET /api/v1/teams/${row.id}`]: (route) =>
          fulfillJson(route, application),
        [`PATCH /api/v1/teams/${row.id}`]: async (route) => {
          expect(route.request().postDataJSON()).toEqual({ action: 'APPROVE' });
          await fulfillJson(
            route,
            {
              type: 'about:blank',
              title: '승인 거부',
              status: 422,
              code: 'APP_019',
              detail: '팀 최소 인원을 충족해야 승인할 수 있습니다.',
              instance: `/api/v1/teams/${row.id}`,
              memberCount: 1,
              teamMinSize: 2,
            },
            422,
          );
        },
      },
    );

    await page.goto(`/programs/${programId}/teams`);
    const disclosure = page.locator('[data-slot="team-member-count"]');
    const count = disclosure.locator('summary');
    await expect(count.locator('data')).toHaveAttribute('value', '1');
    await count.click();
    await expect(disclosure).toHaveAttribute('open', '');
    await expect(disclosure.locator('[data-limit="minimum"]')).toHaveAttribute(
      'value',
      '2',
    );
    await expect(disclosure.locator('[data-limit="maximum"]')).toHaveAttribute(
      'value',
      '3',
    );
    await page.screenshot({
      path: testInfo.outputPath(`staff-count-expanded-${width}.png`),
      fullPage: true,
    });
    await count.click();
    await expect(disclosure).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-missing-members="1"]')).toBeVisible();
    const status = page.locator('tbody').getByRole('combobox');
    await status.selectOption('APPROVED');
    await expect(status).toHaveAttribute('aria-describedby', /^team-notice-/);
    const notice = page.locator(
      `#${await status.getAttribute('aria-describedby')}`,
    );
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toBeVisible();
    await notice.scrollIntoViewIfNeeded();
    await page.addStyleTag({
      content: 'nextjs-portal { display: none !important; }',
    });
    await page.screenshot({
      path: testInfo.outputPath(`staff-refusal-${width}.png`),
      fullPage: true,
    });
    await notice.screenshot({
      path: testInfo.outputPath(`staff-refusal-element-${width}.png`),
    });
    const noticeSize = await notice.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(noticeSize.width).toBeLessThanOrEqual(width - 32);
    expect(noticeSize.scrollWidth).toBeLessThanOrEqual(noticeSize.clientWidth);
    await expect(notice).not.toBeEmpty();
    await expect(status).toBeEnabled();
    await expect(status).toHaveValue('SUBMITTED');
  });
}
