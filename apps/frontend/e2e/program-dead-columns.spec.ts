import { expect, test } from '@playwright/test';
import type { ProgramDetail } from '../src/features/programs/catalog/dto';
import type {
  StaffTeamDetail,
  ProgramTeam,
} from '../src/features/programs/teams/dto';
import type { StudentApplication } from '../src/features/programs/applications/student-application-dto';
import type { ApplicationDetail } from '../src/features/programs/applications/dto';
import type { TeamActivity } from '../src/features/programs/teams/team-activity-dto';
import {
  installSyntheticAuthority,
  fulfillJson,
} from './support/member-access-fixture';

const programId = 'synthetic-cleanup';
const teamId = 'synthetic-team';
const consent = {
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
};
const overview = {
  programId,
  name: '합성 프로그램',
  trackType: 'EXTRACURRICULAR',
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
};
const program: ProgramDetail = {
  id: programId,
  name: '합성 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  description: '',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-12-31T00:00:00Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'SUBMITTED' },
  milestones: [],
};
const team: ProgramTeam = {
  id: teamId,
  name: '합성 팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  status: 'SUBMITTED',
  canInvite: true,
  canRemoveMembers: true,
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
  id: 'synthetic-application',
  programId,
  status: 'SUBMITTED',
  teamId,
  answers: { applicantName: '합성 학생', title: '합성 프로젝트' },
  submittedAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  isRepositoryPublicationPlanned: true,
  rejectionReason: null,
  isManager: true,
  canManage: true,
  canEdit: true,
  canCancel: true,
};
const activity: TeamActivity = {
  teamId: application.id,
  repository: null,
  status: 'NOT_CONNECTED',
  lastSuccessAt: null,
  window: { from: '2026-08-01', to: '2026-08-14', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: false,
  members: [],
};

for (const width of [1440, 390]) {
  test(`student application state and invitations at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
    await installSyntheticAuthority(
      page,
      {
        role: 'STUDENT',
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      {
        'GET /api/v1/consents/current': (route) => fulfillJson(route, consent),
        [`GET /api/v1/programs/${programId}`]: (route) =>
          fulfillJson(route, program),
        [`GET /api/v1/programs/${programId}/overview`]: (route) =>
          fulfillJson(route, overview),
        [`GET /api/v1/programs/${programId}/viewer`]: (route) =>
          fulfillJson(route, program),
        [`GET /api/v1/programs/${programId}/teams/me/membership`]: (route) =>
          fulfillJson(route, { membership: 'LEADER', team }),
        [`GET /api/v1/programs/${programId}/teams/me`]: (route) =>
          fulfillJson(route, { status: application.status, application }),
        [`GET /api/v1/team-invitations/teams/${teamId}/sent`]: (route) =>
          fulfillJson(route, []),
        'GET /api/v1/team-invitations/received': (route) =>
          fulfillJson(route, []),
        [`GET /api/v1/programs/${programId}/teams/${teamId}/activity`]: (
          route,
        ) => fulfillJson(route, activity),
      },
    );

    await page.goto(`/programs/${programId}/team`);

    await expect(
      page.getByRole('heading', { name: '합성 팀', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '신청서 확인·수정' }),
    ).toBeVisible();
    await expect(
      page.getByText('합성 프로젝트', { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`student-${width}.png`),
      fullPage: true,
    });
  });

  test(`staff provisioning labels at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
    const detail: StaffTeamDetail = {
      teamId,
      name: team.name,
      memberCount: team.memberCount,
      members: team.members,
      application: {
        id: application.id,
        status: 'SUBMITTED',
        repositoryConnectionMode: 'NEW',
        repository: null,
        repositoryProvisioning: {
          enabled: true,
          jobStatus: 'FAILED_RETRYABLE',
          updatedAt: application.updatedAt,
          safeErrorClass: 'UNKNOWN',
        },
      },
      repositoryContributions: null,
      deletionScope: {
        teams: 1,
        members: 1,
        invitations: 0,
        submissions: 0,
        submissionEvents: 0,
        detachedRepositories: 0,
        scopeFingerprint: '0123456789abcdef0123456789abcdef',
      },
    };
    const staffApplication: ApplicationDetail = {
      ...application,
      repositoryConnectionMode: 'NEW',
      repositoryProvisioning: {
        enabled: true,
        jobStatus: 'FAILED_RETRYABLE',
        updatedAt: application.updatedAt,
        safeErrorClass: 'UNKNOWN',
      },
      participation: 'TEAM',
      applicant: {
        id: 'synthetic-user',
        name: '합성 학생',
        nickname: 'synthetic-member-access',
      },
      team: { id: teamId, name: team.name, memberCount: 1 },
      repository: null,
      answers: {
        applicantName: '합성 학생',
        title: '합성 프로젝트',
        summary: '',
      },
      reviewHistory: [],
    };
    await installSyntheticAuthority(
      page,
      {
        role: 'STAFF',
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: false,
      },
      {
        'GET /api/v1/consents/current': (route) => fulfillJson(route, consent),
        [`GET /api/v1/programs/${programId}`]: (route) =>
          fulfillJson(route, program),
        [`GET /api/v1/programs/${programId}/viewer`]: (route) =>
          fulfillJson(route, {
            ...program,
            viewer: { role: 'STAFF', applicationStatus: null },
          }),
        [`GET /api/v1/programs/${programId}/overview`]: (route) =>
          fulfillJson(route, { ...overview, viewerRole: 'STAFF' }),
        [`GET /api/v1/programs/${programId}/teams/${teamId}`]: (route) =>
          fulfillJson(route, detail),
        [`GET /api/v1/team-invitations/teams/${teamId}/sent`]: (route) =>
          fulfillJson(route, []),
        [`GET /api/v1/teams/${teamId}`]: (route) =>
          fulfillJson(route, staffApplication),
        [`GET /api/v1/programs/${programId}/teams/${teamId}/activity`]: (
          route,
        ) => fulfillJson(route, activity),
      },
    );

    await page.goto(`/programs/${programId}/teams/${teamId}`);
    await expect(page.getByText('저장소 발급 재시도 대기')).toBeVisible();
    await page.getByText('저장소 발급 재시도 대기').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`staff-canonical-${width}.png`),
      fullPage: true,
    });
  });
}
