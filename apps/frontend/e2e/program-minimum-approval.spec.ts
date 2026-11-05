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
  organizer: '합성 운영처',
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
  id: 'synthetic-minimum-application',
  programId,
  status: 'SUBMITTED',
  submittedAt: '2026-08-15T00:00:00Z',
  rejectionReason: null,
  applicant: {
    id: 'synthetic-applicant',
    name: '합성 신청자',
    nickname: 'synthetic-applicant',
  },
  team: {
    id: 'synthetic-minimum-team',
    name: '합성 지원 팀',
    memberCount: 1,
    members: [
      {
        id: 'synthetic-applicant',
        name: '합성 신청자',
        nickname: 'synthetic-applicant',
      },
    ],
  },
};
const application: ApplicationListItem = {
  ...row,
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: row.submittedAt,
    safeErrorClass: null,
  },
  isRepositoryPublicationPlanned: false,
  participation: 'TEAM',
  repository: null,
  answers: { applicantName: '합성 신청자', title: '', summary: '' },
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
            remainingMilestones: [],
            milestoneDocuments: [],
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
    await expect(page.getByText('수락 1/2명', { exact: true })).toBeVisible();
    const status = page.getByRole('combobox', {
      name: 'synthetic-applicant 신청 상태',
    });
    await status.selectOption('APPROVED');
    const notice = page
      .getByRole('status')
      .filter({ hasText: /팀 최소 인원|판정 요청이 실패/ });
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
    await expect(notice).toHaveText(
      '팀 최소 인원이 부족해 승인할 수 없습니다. 초대한 팀원이 수락한 뒤 다시 승인해 주세요.',
    );
    await expect(status).toHaveValue('SUBMITTED');
  });
}
