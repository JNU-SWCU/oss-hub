import { expect, test, type Route } from '@playwright/test';
import { installBrowserAudit } from './support/browser-audit';
import {
  captureBothViewports,
  capturePhase,
  fulfillJson,
  installExactApiRouter,
  type EvidenceApiHandlers,
} from './support/evidence-capture';

const CAPTURE_PHASE_VARIABLE = 'TEAM_MANAGEMENT_CAPTURE_PHASE';
const ARTIFACT_PREFIX = 'team-management';

const PROGRAM_ID = 'synthetic-program';
const APPLICATION_ID = 'synthetic-application';

const PROGRAM_DETAIL = {
  id: PROGRAM_ID,
  name: '합성 프로그램',
  organizer: 'OSS Center',
  trackType: 'EXTRACURRICULAR',
  category: 'BASIC',
  lifecycle: 'PUBLISHED',
  description: '합성 설명',
  applicationStartAt: '2026-08-01T00:00:00.000Z',
  applicationEndAt: '2026-12-31T00:00:00.000Z',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-12-31T00:00:00.000Z',
  repositoryProvisioningEnabled: true,
  applicationTemplateKey: 'basic',
  applicationTemplateVersion: 1,
} as const;

const PROGRAM_OVERVIEW = {
  programId: PROGRAM_ID,
  name: '합성 프로그램',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  milestoneCount: 0,
  boardPostCount: 0,
  participantCount: 2,
  teamCount: 1,
  connectedRepositoryCount: 1,
  viewerRole: 'STAFF',
  viewerDocumentsCompleted: null,
  viewerDocumentsTotal: null,
  fullySubmittedParticipantCount: 0,
  remainingMilestones: [],
  milestoneDocuments: [],
} as const;

const STUDENT_SESSION = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-student',
    name: '합성 학생',
    email: null,
    avatarUrl: null,
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
} as const;

const STUDENT_TEAM = {
  id: 'synthetic-team',
  name: '합성 팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  hasApplication: true,
  canInvite: true,
  canRemoveMembers: false,
  canLeave: false,
  isLeader: true,
  members: [
    {
      userId: 'synthetic-student',
      nickname: 'synthetic-student',
      name: '합성 학생',
      isLeader: true,
    },
  ],
} as const;

const REJECTED_STUDENT_APPLICATION = {
  id: APPLICATION_ID,
  programId: PROGRAM_ID,
  status: 'REJECTED',
  teamId: 'synthetic-team',
  answers: { applicantName: '합성 학생', title: '합성 신청 제목' },
  submittedAt: '2026-08-05T05:32:00.000Z',
  updatedAt: '2026-08-06T01:00:00.000Z',
  isRepositoryPublicationPlanned: true,
  rejectionReason: '제출 서류가 비어 있습니다.',
  isManager: true,
  canEdit: false,
  canCancel: false,
} as const;

const APPLICATION_TEMPLATES = {
  items: [
    {
      key: 'basic',
      version: 1,
      name: '기본 신청서',
      participation: 'team',
      fields: [
        {
          key: 'applicantName',
          type: 'auto',
          label: '신청자 이름',
          required: true,
        },
        { key: 'title', type: 'text', label: '신청 제목', required: true },
        {
          key: 'summary',
          type: 'textarea',
          label: '지원 동기 · 계획',
          required: true,
        },
      ],
    },
  ],
} as const;

test('반려된 학생 신청 화면이 Before/After 에서 같은지 찍는다', async ({
  page,
}, testInfo) => {
  const phase = capturePhase(CAPTURE_PHASE_VARIABLE);
  const browserAudit = installBrowserAudit(page);

  await installExactApiRouter(page, (): EvidenceApiHandlers => {
    const application = {
      ...REJECTED_STUDENT_APPLICATION,
      canManage: phase === 'after',
    };
    return {
      'GET /api/v1/auth/session': (route: Route) =>
        fulfillJson(route, STUDENT_SESSION),
      [`GET /api/v1/programs/${PROGRAM_ID}`]: (route: Route) =>
        fulfillJson(route, PROGRAM_DETAIL),
      [`GET /api/v1/programs/${PROGRAM_ID}/viewer`]: (route: Route) =>
        fulfillJson(route, PROGRAM_DETAIL),
      [`GET /api/v1/programs/${PROGRAM_ID}/overview`]: (route: Route) =>
        fulfillJson(route, { ...PROGRAM_OVERVIEW, viewerRole: 'STUDENT' }),
      [`GET /api/v1/programs/${PROGRAM_ID}/teams/me`]: (route: Route) =>
        fulfillJson(route, STUDENT_TEAM),
      [`GET /api/v1/programs/${PROGRAM_ID}/applications/me`]: (route: Route) =>
        fulfillJson(route, application),

      [`GET /api/v1/programs/${PROGRAM_ID}/teams/${STUDENT_TEAM.id}/activity`]:
        (route: Route) =>
          fulfillJson(route, {
            applicationId: APPLICATION_ID,
            repository: null,
            status: 'NOT_CONNECTED',
            lastSuccessAt: null,
            window: {
              from: '2026-08-05',
              to: '2026-12-31',
              timeZone: 'Asia/Seoul',
            },
            canEditRepositoryUrl: false,
            members: [],
          }),
      'GET /api/v1/team-invitations/received': (route: Route) =>
        fulfillJson(route, []),
      [`GET /api/v1/team-invitations/teams/${STUDENT_TEAM.id}/sent`]: (
        route: Route,
      ) => fulfillJson(route, []),
    };
  });

  await page.goto(`/programs/${PROGRAM_ID}/team`);

  const main = page.locator('main');

  await expect(main.getByText('반려 사유')).toBeVisible();
  await expect(main.getByText('제출 서류가 비어 있습니다.')).toBeVisible();

  await captureBothViewports({
    page,
    testInfo,
    phase,
    prefix: ARTIFACT_PREFIX,
    name: 'student-rejected-application',
    target: page.locator('body'),
  });

  browserAudit.assertClean();
});

test('반려 상태 학생 신청 화면이 Before/After 에서 같은지 찍는다', async ({
  page,
}, testInfo) => {
  const phase = capturePhase(CAPTURE_PHASE_VARIABLE);
  const browserAudit = installBrowserAudit(page);

  await installExactApiRouter(page, (): EvidenceApiHandlers => {
    const application = {
      ...REJECTED_STUDENT_APPLICATION,
      canManage: phase === 'after',
    };
    return {
      'GET /api/v1/auth/session': (route: Route) =>
        fulfillJson(route, STUDENT_SESSION),
      'GET /api/v1/programs/application-templates': (route: Route) =>
        fulfillJson(route, APPLICATION_TEMPLATES),
      [`GET /api/v1/programs/${PROGRAM_ID}`]: (route: Route) =>
        fulfillJson(route, PROGRAM_DETAIL),
      [`GET /api/v1/programs/${PROGRAM_ID}/viewer`]: (route: Route) =>
        fulfillJson(route, PROGRAM_DETAIL),
      [`GET /api/v1/programs/${PROGRAM_ID}/overview`]: (route: Route) =>
        fulfillJson(route, { ...PROGRAM_OVERVIEW, viewerRole: 'STUDENT' }),
      [`GET /api/v1/programs/${PROGRAM_ID}/applications/me`]: (route: Route) =>
        fulfillJson(route, application),
      'GET /api/v1/team-invitations/received': (route: Route) =>
        fulfillJson(route, []),
    };
  });

  await page.goto(`/programs/${PROGRAM_ID}/apply`);

  const main = page.locator('main');
  await expect(main).toBeVisible();

  await captureBothViewports({
    page,
    testInfo,
    phase,
    prefix: ARTIFACT_PREFIX,
    name: 'student-apply-screen',
    target: page.locator('body'),
  });

  browserAudit.assertClean();
});
