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

const REJECTED_DECISION = {
  applicationId: APPLICATION_ID,
  status: 'REJECTED',
  rejectionReason: '합성 반려 사유',
} as const;

test('팀 관리 통합이 신청 상세에서 바꾸는 것을 Before/After 로 찍는다', async ({
  page,
}, testInfo) => {
  const phase = capturePhase(CAPTURE_PHASE_VARIABLE);
  const browserAudit = installBrowserAudit(page);

  // 반려가 실제로 처리되면 상세를 다시 읽는다 — 그때 돌려줄 모양을 phase 가 정한다.
  let decided = false;

  await installExactApiRouter(page, (): EvidenceApiHandlers => {
    const detail =
      phase === 'before'
        ? APPROVED_APPLICATION
        : { ...APPROVED_APPLICATION, reviewHistory: REVIEW_HISTORY };
    const rejectedDetail = {
      ...detail,
      status: 'REJECTED',
      rejectionReason: '합성 반려 사유',
    };
    return {
      'GET /api/v1/auth/session': (route: Route) =>
        fulfillJson(route, STAFF_SESSION),
      [`GET /api/v1/programs/${PROGRAM_ID}`]: (route: Route) =>
        fulfillJson(route, PROGRAM_DETAIL),
      [`GET /api/v1/programs/${PROGRAM_ID}/overview`]: (route: Route) =>
        fulfillJson(route, PROGRAM_OVERVIEW),
      [`GET /api/v1/applications/${APPLICATION_ID}`]: (route: Route) =>
        fulfillJson(route, decided ? rejectedDetail : detail),
      [`PATCH /api/v1/applications/${APPLICATION_ID}`]: async (
        route: Route,
      ) => {
        if (phase === 'before') {
          // 예전 서버 — 완료된 프로비저닝이 반려를 잠근다.
          await route.fulfill({
            status: 409,
            contentType: 'application/problem+json',
            body: JSON.stringify(REVERT_BLOCKED_PROBLEM),
          });
          return;
        }
        decided = true;
        await fulfillJson(route, REJECTED_DECISION);
      },
    };
  });

  await page.goto(`/programs/${PROGRAM_ID}/applications/${APPLICATION_ID}`);

  const main = page.locator('main');
  await expect(main.getByText('합성 신청자').first()).toBeVisible();

  // 장면 1 — 승인된 신청의 상세.
  // 검토 이력이 응답에 더해져도(After) 이 화면은 Before 와 같아야 한다. 상세 화면이
  // 아직 타임라인을 그리지 않기 때문이며, 그 동일성이 「additive 확장이 기존 화면을
  // 깨지 않는다」의 증거다.
  await captureBothViewports({
    page,
    testInfo,
    phase,
    prefix: ARTIFACT_PREFIX,
    name: 'application-detail-approved',
    target: main,
  });

  /*
   * 장면 2 — 저장소가 이미 만들어진 승인의 반려 버튼.
   *
   * 여기서 실제로 확인된 것을 그대로 적는다. 프런트는 서버에 요청을 보내기 전에
   * `isApplicationRevertBlocked`로 버튼을 **직접 비활성화**한다. 그래서 backend 에서
   * APP_023 을 없애도 이 화면의 버튼은 여전히 눌리지 않는다 — 판정이 열리는 것은
   * 프런트 가드까지 함께 걷어내는 후행 PR 에서다.
   *
   * Before 와 After 가 같은 이유가 이것이며, 클릭해서 409/200 을 가르는 증거는
   * 이 화면에서 만들 수 없다.
   */
  const rejectButton = main.getByRole('button', { name: '반려' });
  await expect(rejectButton).toBeDisabled();
  const guardNotice = main.getByText(
    '저장소가 이미 만들어져 이 승인은 반려로 바꿀 수 없습니다.',
  );
  await expect(guardNotice).toBeVisible();

  // 판정 영역만 잘라 찍는다 — 화면 전체를 다시 찍으면 장면 1 과 같은 이미지가 되어
  // 리뷰어가 두 장을 구분할 수 없다.
  await captureBothViewports({
    page,
    testInfo,
    phase,
    prefix: ARTIFACT_PREFIX,
    name: 'approved-reject-blocked-by-client-guard',
    target: guardNotice.locator('..'),
  });

  browserAudit.assertClean();
});
