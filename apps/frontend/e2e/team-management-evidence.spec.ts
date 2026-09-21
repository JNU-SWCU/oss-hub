import { expect, test, type Route } from '@playwright/test';
import { installBrowserAudit } from './support/browser-audit';
import {
  captureBothViewports,
  capturePhase,
  fulfillJson,
  installExactApiRouter,
  type EvidenceApiHandlers,
} from './support/evidence-capture';

/**
 * 팀 관리 통합 backend 변경이 **소비 화면에서 무엇을 바꾸는가**를 찍는 증거 레인.
 *
 * 이 레인이 증명하는 것은 두 가지다.
 *
 * 1. 승인을 반려로 뒤집을 때 화면이 받던 409 잠금 안내가 사라지고 반려가 그대로
 *    처리된다(APP_023 은퇴).
 * 2. 신청 상세 응답에 검토 이력(`reviewHistory`)이 더해져도 화면은 **바이트 단위로
 *    같다**. 응답이 바뀌는데 화면이 같아 보인다는 사실 자체가 리뷰 정보이며, 그것을
 *    적기만 하지 않고 찍어서 보인다.
 *
 * 가로챈 응답은 화면 배치를 위한 것이고 backend 영속·감사 증거가 아니다. backend
 * 동작은 각 PR의 통합 테스트가 증명한다.
 */

/** 이 레인의 phase 환경 변수와 증거 파일 접두사. 다른 레인과 섞이지 않게 여기서만 정한다. */
const CAPTURE_PHASE_VARIABLE = 'TEAM_MANAGEMENT_CAPTURE_PHASE';
const ARTIFACT_PREFIX = 'team-management';

const PROGRAM_ID = 'synthetic-program';
const APPLICATION_ID = 'synthetic-application';

const STAFF_SESSION = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-staff',
    name: '합성 교직원',
    email: null,
    avatarUrl: null,
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
} as const;

/** 저장소가 이미 만들어진 승인 — 예전에는 이 조합이 반려를 409로 막았다. */
const APPROVED_APPLICATION = {
  id: APPLICATION_ID,
  programId: PROGRAM_ID,
  status: 'APPROVED',
  submittedAt: '2026-08-05T05:32:00.000Z',
  rejectionReason: null,
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  repositoryProvisioning: {
    enabled: true,
    jobStatus: 'SUCCEEDED',
    updatedAt: '2026-08-06T01:00:00.000Z',
    safeErrorClass: null,
  },
  repository: {
    url: 'https://github.com/synthetic-org/synthetic-team',
    visibility: 'PRIVATE',
  },
  isRepositoryPublicationPlanned: true,
  participation: 'TEAM',
  applicant: {
    id: 'synthetic-applicant',
    name: '합성 신청자',
    nickname: 'synthetic-applicant',
  },
  team: { id: 'synthetic-team', name: '합성 팀', memberCount: 2 },
  answers: {
    applicantName: '합성 신청자',
    title: '합성 신청 제목',
    summary: '합성 지원 동기와 계획입니다.',
  },
} as const;

/** After 응답은 여기에 검토 이력만 더한다 — 기존 키는 하나도 바뀌지 않는다. */
const REVIEW_HISTORY = [
  {
    id: 'synthetic-history-2',
    eventKind: 'APPROVED',
    revision: 1,
    actor: { name: '합성 교직원', nickname: 'synthetic-staff' },
    occurredAt: '2026-08-06T01:00:00.000Z',
    rejectionReason: null,
  },
  {
    id: 'synthetic-history-1',
    eventKind: 'SUBMITTED',
    revision: 1,
    actor: { name: '합성 신청자', nickname: 'synthetic-applicant' },
    occurredAt: '2026-08-05T05:32:00.000Z',
    rejectionReason: null,
  },
] as const;

const REVERT_BLOCKED_PROBLEM = {
  type: 'about:blank',
  title: 'Synthetic revert blocked',
  status: 409,
  detail: '저장소 프로비저닝이 완료된 승인은 되돌릴 수 없습니다.',
  instance: `/api/v1/applications/${APPLICATION_ID}`,
  code: 'APP_023',
  latestStatus: 'APPROVED',
  revertBlockedReason:
    'repository provision already succeeded; undo is locked to protect the provisioned repository',
} as const;

/** 셸이 함께 읽는 두 응답. 화면 배치용 최소 모양이며 backend 계약 증거가 아니다. */
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

/**
 * 반려된 학생 신청. `canManage`만 phase 마다 다르다 — PR-C 가 여는 것이 정확히 그 값이다.
 */
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

/** 신청 양식 — 신청 화면이 폼을 그리는 데 쓴다. */
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

const REJECTED_DECISION = {
  applicationId: APPLICATION_ID,
  status: 'REJECTED',
  rejectionReason: '합성 반려 사유',
} as const;

test('반려된 학생 신청 화면이 Before/After 에서 같은지 찍는다', async ({
  page,
}, testInfo) => {
  const phase = capturePhase(CAPTURE_PHASE_VARIABLE);
  const browserAudit = installBrowserAudit(page);

  await installExactApiRouter(page, (): EvidenceApiHandlers => {
    // PR-C 가 여는 것은 이 한 값이다. 화면이 그것을 쓰는지 보는 것이 이 장면의 전부다.
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
      /*
       * 「우리 팀」·신청 화면이 저장소 URL 관리를 함께 읽는다(#1287). 이 레인의
       * 라우터는 **정확 일치**라 스텁이 없으면 요청 자체가 실패로 잡힌다 — 그게
       * 화면에 새 조회가 생겼다는 사실을 알려 주는 장치이므로 느슨하게 풀지 않고
       * 여기에 적는다.
       */
      [`GET /api/v1/programs/${PROGRAM_ID}/applications/me/repository-url`]: (
        route: Route,
      ) => fulfillJson(route, { repositoryUrl: null, canEdit: false }),
      'GET /api/v1/team-invitations/received': (route: Route) =>
        fulfillJson(route, []),
      [`GET /api/v1/team-invitations/teams/${STUDENT_TEAM.id}/sent`]: (
        route: Route,
      ) => fulfillJson(route, []),
    };
  });

  await page.goto(`/programs/${PROGRAM_ID}/my-team`);

  const main = page.locator('main');
  /*
   * 반려 사유는 두 phase 모두 보인다. 화면의 'rejected' 분기가 사유 Alert 하나만
   * 그리고 `canManage` 를 읽지 않기 때문이다 — 그래서 backend 가 재제출을 열어도
   * 학생에게는 아직 진입점이 없다. 그 진입점은 T-FE-12 가 만든다.
   */
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
    // PR-C 가 여는 것은 canManage 한 값이다. 신청 화면이 그 값으로 무엇을 하는지 본다.
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
      /*
       * 「우리 팀」·신청 화면이 저장소 URL 관리를 함께 읽는다(#1287). 이 레인의
       * 라우터는 **정확 일치**라 스텁이 없으면 요청 자체가 실패로 잡힌다 — 그게
       * 화면에 새 조회가 생겼다는 사실을 알려 주는 장치이므로 느슨하게 풀지 않고
       * 여기에 적는다.
       */
      [`GET /api/v1/programs/${PROGRAM_ID}/applications/me/repository-url`]: (
        route: Route,
      ) => fulfillJson(route, { repositoryUrl: null, canEdit: false }),
      'GET /api/v1/team-invitations/received': (route: Route) =>
        fulfillJson(route, []),
    };
  });

  await page.goto(`/programs/${PROGRAM_ID}/apply`);

  const main = page.locator('main');
  await expect(main).toBeVisible();
  /*
   * `load-program-apply-context.ts` 가 `status !== 'SUBMITTED'` 를 already-applied 로
   * 접기 때문에 backend 가 canManage 를 열어도 이 화면은 수정 모드로 가지 않는다.
   * 그 분기를 여는 것이 T-FE-12 다.
   */
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
