import { expect, test } from '@playwright/test';
import type { ProgramDetail } from '../src/features/programs/catalog/dto';
import type { ProgramTeam } from '../src/features/programs/teams/dto';
import type { StudentApplication } from '../src/features/programs/applications/student-application-dto';
import type { SentTeamInvitation } from '../src/features/programs/teams/team-invitation-dto';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

const programId = 'synthetic-post-apply';
const teamId = 'synthetic-post-apply-team';
const program: ProgramDetail = {
  teamMinSize: 2,
  teamMaxSize: 3,
  id: programId,
  name: '합성 팀 프로젝트',
  organizer: '합성 운영처',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-08-01T00:00:00Z',
    endsAt: '2026-08-31T00:00:00Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};
const team: ProgramTeam = {
  id: teamId,
  name: '합성 지원 팀',
  memberCount: 1,
  minMembers: 2,
  maxMembers: 3,
  hasApplication: true,
  canInvite: true,
  canRemoveMembers: false,
  canLeave: false,
  isLeader: true,
  members: [
    {
      userId: 'synthetic-user',
      nickname: 'synthetic-member-access',
      name: '합성 학생',
      isLeader: true,
    },
  ],
};
const application: StudentApplication = {
  id: 'synthetic-post-apply-application',
  programId,
  status: 'SUBMITTED',
  teamId,
  answers: { applicantName: '합성 학생', title: '' },
  submittedAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
  isRepositoryPublicationPlanned: false,
  rejectionReason: null,
  isManager: true,
  canManage: true,
  canEdit: true,
  canCancel: true,
};
const candidate = {
  id: 'synthetic-invitee',
  nickname: 'synthetic-invitee',
  name: '합성 팀원',
  avatarUrl: null,
};
const invitation: SentTeamInvitation = {
  id: 'synthetic-invitation',
  teamId,
  programId,
  invitedById: 'synthetic-user',
  status: 'PENDING',
  invitedAt: '2026-08-15T00:00:00Z',
  respondedAt: null,
  invitee: candidate,
};

for (const mode of ['before', 'after'] as const) {
  for (const width of [1440, 390]) {
    test(`history compatibility ${mode} at ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
      let cancelled = false;
      const legacyClosed = {
        ...invitation,
        id: 'synthetic-old-closed',
        status: 'DECLINED',
        respondedAt: '2026-08-14T00:00:00Z',
      };
      await installSyntheticAuthority(
        page,
        {
          role: 'STUDENT',
          memberKind: 'STUDENT',
          hasStaffAccess: false,
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
              lifecycle: 'PUBLISHED',
              milestoneCount: 0,
              boardPostCount: 0,
              participantCount: 1,
              teamCount: 1,
              connectedRepositoryCount: 0,
              viewerRole: 'STUDENT',
              viewerDocumentsCompleted: null,
              viewerDocumentsTotal: null,
              fullySubmittedParticipantCount: 0,
              remainingMilestones: [],
              milestoneDocuments: [],
            }),
          [`GET /api/v1/programs/${programId}/teams/me`]: (route) =>
            fulfillJson(route, { membership: 'LEADER', team }),
          [`GET /api/v1/programs/${programId}/applications/me`]: (route) =>
            fulfillJson(route, { status: 'SUBMITTED', application }),
          [`GET /api/v1/team-invitations/teams/${teamId}/sent`]: (route) =>
            fulfillJson(route, [
              ...(mode === 'before' ? [legacyClosed] : []),
              ...(!cancelled
                ? [invitation]
                : mode === 'before'
                  ? [{ ...invitation, status: 'DECLINED' }]
                  : []),
            ]),
          [`POST /api/v1/team-invitations/${invitation.id}/cancel`]: async (
            route,
          ) => {
            cancelled = true;
            await route.fulfill({ status: 204 });
          },
        },
      );
      await page.goto(`/programs/${programId}/team`);
      const cancel = page.getByRole('button', { name: /초대 취소$/ });
      await expect(cancel).toHaveCount(1);
      await expect(cancel).toBeVisible();
      await cancel.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await page.screenshot({
        path: testInfo.outputPath(`${mode}-pending-${width}.png`),
        fullPage: width !== 390,
      });
      await cancel.click();
      await expect(cancel).toHaveCount(0);
      expect(cancelled).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${mode}-closed-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}

for (const width of [1440, 390]) {
  test(`named application then invitation and capacity error at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
    let submitted = false;
    let sent = false;
    let full = false;
    async function capture(name: string) {
      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; }',
      });
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${width}.png`),
        fullPage: true,
      });
      if (name === 'apply' || name === 'nominated' || name === 'success') {
        const element =
          name === 'success'
            ? page.locator('main[data-slot="page-body"]')
            : page
                .locator('main[data-slot="page-body"] > [data-slot="card"]')
                .nth(1);
        await element.screenshot({
          path: testInfo.outputPath(`${name}-element.png`),
        });
      }
    }
    await installSyntheticAuthority(
      page,
      {
        role: 'STUDENT',
        memberKind: 'STUDENT',
        hasStaffAccess: false,
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
        'GET /api/v1/programs/application-templates': (route) =>
          fulfillJson(route, {
            items: [
              {
                key: 'basic',
                version: 1,
                name: '기본 신청서',
                fields: [
                  {
                    key: 'applicantName',
                    type: 'auto',
                    label: '신청자',
                    required: true,
                  },
                ],
              },
            ],
          }),
        [`GET /api/v1/programs/${programId}`]: (route) =>
          fulfillJson(route, {
            ...program,
            viewer: {
              role: 'STUDENT',
              applicationStatus: submitted ? 'SUBMITTED' : null,
            },
          }),
        [`GET /api/v1/programs/${programId}/viewer`]: (route) =>
          fulfillJson(route, program),
        [`GET /api/v1/programs/${programId}/overview`]: (route) =>
          fulfillJson(route, {
            programId,
            name: program.name,
            trackType: 'EXTRACURRICULAR',
            lifecycle: 'PUBLISHED',
            milestoneCount: 0,
            boardPostCount: 0,
            participantCount: 1,
            teamCount: 1,
            connectedRepositoryCount: 0,
            viewerRole: 'STUDENT',
            viewerDocumentsCompleted: null,
            viewerDocumentsTotal: null,
            fullySubmittedParticipantCount: 0,
            remainingMilestones: [],
            milestoneDocuments: [],
          }),
        [`GET /api/v1/programs/${programId}/teams/me`]: (route) =>
          fulfillJson(
            route,
            submitted
              ? { membership: 'LEADER', team }
              : { membership: 'NONE', team: null },
          ),
        [`GET /api/v1/team-invitations/programs/${programId}/search`]: (
          route,
        ) => fulfillJson(route, [candidate]),
        [`GET /api/v1/application-preparations/programs/${programId}/me`]: (
          route,
        ) => fulfillJson(route, { membership: 'NONE', preparation: null }),
        [`POST /api/v1/programs/${programId}/applications`]: async (route) => {
          expect(route.request().postDataJSON()).toMatchObject({
            teamName: team.name,
            inviteeUserIds: [candidate.id],
          });
          submitted = true;
          sent = true;
          await fulfillJson(route, application, 201);
        },
        [`GET /api/v1/programs/${programId}/applications/me`]: (route) =>
          fulfillJson(route, { status: application.status, application }),
        [`GET /api/v1/team-invitations/teams/${teamId}/sent`]: (route) =>
          fulfillJson(route, sent ? [invitation] : []),
        [`GET /api/v1/team-invitations/teams/${teamId}/search`]: (route) =>
          fulfillJson(route, [candidate]),
        [`POST /api/v1/team-invitations/teams/${teamId}/invitations`]: async (
          route,
        ) => {
          expect(submitted).toBe(true);
          if (full) {
            await fulfillJson(
              route,
              {
                type: 'about:blank',
                instance: `/api/v1/team-invitations/teams/${teamId}/invitations`,
                status: 409,
                code: 'TIV_009',
                title: '정원 초과',
                detail: '팀 최대 인원을 초과할 수 없습니다.',
              },
              409,
            );
          } else {
            sent = true;
            await fulfillJson(route, invitation, 201);
          }
        },
      },
    );
    await page.goto(`/programs/${programId}/apply`);
    await expect(page.getByLabel('팀 이름')).toBeVisible();
    await capture('apply');
    const preSubmitInvites = await page
      .getByRole('button', { name: '팀원 초대', exact: true })
      .count();
    await page.getByLabel('팀 이름').fill(team.name);
    await page.locator('#personal-data-consent').check();
    await expect(
      page.getByRole('button', { name: '신청 제출', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: '팀원 지정', exact: true }).click();
    await page.locator('#invite-search').fill('synthetic');
    await page.getByRole('button', { name: '지정', exact: true }).click();
    await expect(page.getByText('지정됨', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '신청 제출', exact: true }),
    ).toBeEnabled();
    await capture('nominated');
    await page
      .getByRole('button', { name: '신청 제출', exact: true })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await capture('apply-submit');
    await page.getByRole('button', { name: '신청 제출', exact: true }).click();
    await page
      .getByRole('button', { name: '신청서 제출', exact: true })
      .click();
    await expect(
      page.getByText('신청이 접수되었습니다', { exact: true }),
    ).toBeVisible();
    await capture('success');
    await page.getByRole('link', { name: '우리 팀 보기', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /초대 취소$/ }),
    ).toBeVisible();
    await capture('sent');
    full = true;
    sent = false;
    await page.reload();
    await page.getByRole('button', { name: '팀원 초대', exact: true }).click();
    await page.locator('#invite-search').fill('synthetic');
    await page.getByRole('button', { name: '초대', exact: true }).click();
    await expect(
      page
        .getByRole('dialog')
        .getByText('팀 최대 인원을 초과할 수 없습니다.', { exact: true }),
    ).toBeVisible();
    await capture('capacity');
    submitted = false;
    await page.clock.setFixedTime(new Date('2026-09-01T00:00:00Z'));
    await page.goto(`/programs/${programId}/apply`);
    await expect(
      page.getByText('신청 기간이 아닙니다', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '신청 제출', exact: true }),
    ).toHaveCount(0);
    await capture('closed');
    expect(preSubmitInvites).toBe(0);
  });
}
