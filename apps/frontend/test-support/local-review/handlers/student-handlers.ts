import type { ActivityGranularity } from '@/features/activity-timeline/types';
import { PROGRAM_TEMPLATE_DEFINITIONS } from '@/features/programs/program-templates';
import { apiPath } from '@/lib/api-client';
import {
  accepted,
  bodyEnum,
  bodyNullableString,
  bodyRecord,
  bodyString,
  json,
  matchGet,
  matchPath,
  notFound,
  problem,
  unauthenticated,
  unauthorized,
  type LocalReviewContext,
  type LocalReviewHandler,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { STUDENT_JOURNEY_RESPONSES } from '../student-journey-fixtures';
import {
  JOINED_TEAM_FIXTURE,
  MY_APPLICATION_FIXTURES,
  MY_TEAM_FIXTURES,
  PROGRAM_CHECKLISTS,
  SUBMISSION_FORMS,
  isPublicProgramId,
  programActivityFor,
  programDetailFor,
} from './student-program-fixtures';

/**
 * 학생 동선의 로컬 검토 응답.
 * 담당 경로: `programs/{id}/viewer|activity|submissions/me|teams/me`,
 * `programs/application-templates`, `programs/{id}/milestones/{id}/submission-form`,
 * `dashboard/student*`, 학생 조작(신청·팀·제출·재제출).
 *
 * `fixture-response.ts`가 `student` 페르소나에 한해 `STUDENT_JOURNEY_RESPONSES`를 먼저
 * 시도한다. 여기서는 그 규칙이 응답하지 못한 경우만 채운다.
 */

const PROGRAM_NOT_FOUND_CODE = 'PROGRAM_NOT_FOUND';

/**
 * 학생 동선 픽스처를 다른 학생 역할 페르소나(`settings`·`wrong-role`)에도 그대로
 * 준다. 같은 데이터를 두 벌 적으면 한쪽만 고쳐져 화면이 어긋난다.
 */
function studentJourneyFallbackHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (context.method !== 'GET' || context.role !== 'STUDENT') return null;
  const body = STUDENT_JOURNEY_RESPONSES[context.path];
  return body === undefined ? null : json(200, body);
}

/**
 * 신청 양식 템플릿. 카테고리 정의(SSOT)에서 만들어 키·버전이 화면 폴백과 어긋나지
 * 않게 한다. 실제 API처럼 participation은 대문자로 준다.
 */
function applicationTemplatesHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (matchGet(context, 'programs/application-templates') === null) return null;
  return json(200, {
    items: PROGRAM_TEMPLATE_DEFINITIONS.map((definition) => ({
      key: definition.template.key,
      version: definition.template.version,
      name: definition.template.name,
      participation:
        definition.template.participation === 'team' ? 'TEAM' : 'INDIVIDUAL',
      fields: definition.template.fields,
    })),
  });
}

const MONTH_ACTIVITY_POINTS = [
  { period: '2026-03', commitCount: 4, pullRequestCount: 1, releaseCount: 0 },
  { period: '2026-04', commitCount: 9, pullRequestCount: 2, releaseCount: 1 },
  { period: '2026-05', commitCount: 6, pullRequestCount: 1, releaseCount: 0 },
  { period: '2026-06', commitCount: 14, pullRequestCount: 3, releaseCount: 1 },
  { period: '2026-07', commitCount: 21, pullRequestCount: 5, releaseCount: 2 },
] as const;

const YEAR_ACTIVITY_POINTS = [
  { period: '2025', commitCount: 12, pullRequestCount: 3, releaseCount: 1 },
  { period: '2026', commitCount: 54, pullRequestCount: 12, releaseCount: 4 },
] as const;

/** 파서가 `total === commit + pr + release`를 검사하므로 합계를 계산해서 준다. */
function activityPoints(granularity: ActivityGranularity) {
  const points =
    granularity === 'YEAR' ? YEAR_ACTIVITY_POINTS : MONTH_ACTIVITY_POINTS;
  return points.map((point) => ({
    ...point,
    total: point.commitCount + point.pullRequestCount + point.releaseCount,
  }));
}

function activityTimelineHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (matchGet(context, 'dashboard/student/activity-timeline') === null) {
    return null;
  }
  if (context.role !== 'STUDENT') {
    return context.isAuthenticated
      ? problem(403, 'ACT_403', apiPath(context.path))
      : unauthorized(context.path);
  }

  // 파서는 응답의 granularity가 요청한 값과 같을 때만 통과시킨다.
  const granularity: ActivityGranularity =
    context.searchParams.get('granularity') === 'YEAR' ? 'YEAR' : 'MONTH';

  return json(200, {
    dataAsOf: '2026-07-31T00:00:00.000Z',
    programs: [
      {
        programId: 'program-capstone',
        programName: '합성 캡스톤 2026',
        year: 2026,
        applicationMode: 'PERSONAL',
      },
      {
        programId: 'program-oss-contest',
        programName: '합성 OSS 경진대회',
        year: 2026,
        applicationMode: 'TEAM',
      },
    ],
    series: { granularity, points: activityPoints(granularity) },
  });
}

function applicationDecisionNotificationsHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (
    matchGet(context, 'users/me/notifications/application-decisions') !== null
  ) {
    if (!context.isAuthenticated) return unauthorized(context.path);
    return json(
      200,
      context.role === 'STUDENT'
        ? [
            {
              id: 'synthetic-application-decision-notice',
              applicationId: 'synthetic-application-basic',
              programId: 'program-capstone',
              programName: '합성 캡스톤 2026',
              decision: 'APPROVED',
              decidedAt: '2026-08-08T23:00:00.000Z',
            },
            // 반려 알림. 이 안내의 링크가 `/programs/{id}/apply`로 가고 그 화면이
            // 반려 사유를 그린다 — 승인 알림만 두면 검토자가 그 왕복을 눌러 볼 수
            // 없다. `programId`는 반려 신청 픽스처가 있는 프로그램이어야 한다
            // (`student-program-fixtures.ts`의 `MY_APPLICATION_FIXTURES`).
            // 사유 원문은 여기 담지 않는다 — 실제 알림 payload에도 없다.
            {
              id: 'synthetic-application-rejection-notice',
              applicationId: 'synthetic-application-sw-value',
              programId: 'program-sw-value',
              programName: '합성 SW가치확산 프로그램',
              decision: 'REJECTED',
              decidedAt: '2026-06-28T23:00:00.000Z',
            },
          ]
        : [],
    );
  }

  if (
    context.method === 'PATCH' &&
    matchPath(
      'users/me/notifications/application-decisions/:notificationId/read',
      context.path,
    ) !== null
  ) {
    return json(200, null);
  }
  return null;
}

/**
 * 로그인 사용자의 프로그램 상세. 비로그인은 **401**이어야 한다 —
 * `features/programs/api.ts`의 `getProgramDetail`이 401일 때만 공개 상세로 폴백하고,
 * 404를 주면 그 폴백 흐름이 재현되지 않는다.
 */
function programViewerHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:id/viewer');
  if (params === null) return null;
  if (!context.isAuthenticated) return unauthorized(context.path);

  const programId = params.id ?? '';
  return isPublicProgramId(programId)
    ? json(200, programDetailFor(programId, context.role))
    : notFound(PROGRAM_NOT_FOUND_CODE, context.path);
}

/** 비로그인 폴백이 읽는 공개 상세. 뷰어 정보 없이 프로그램 정보만 준다. */
function publicProgramDetailHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:id');
  if (params === null) return null;

  const programId = params.id ?? '';
  if (programId === 'application-templates') return null;

  return isPublicProgramId(programId)
    ? json(200, programDetailFor(programId, null))
    : notFound(PROGRAM_NOT_FOUND_CODE, context.path);
}

function programActivityHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:id/activity');
  if (params === null) return null;

  const programId = params.id ?? '';
  return isPublicProgramId(programId)
    ? json(200, programActivityFor(programId))
    : notFound(PROGRAM_NOT_FOUND_CODE, context.path);
}

function submissionChecklistHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:id/submissions/me');
  if (params === null) return null;

  const programId = params.id ?? '';
  const checklist = PROGRAM_CHECKLISTS[programId];
  if (checklist !== undefined) return json(200, checklist);

  // 신청 전이거나 승인된 신청이 없으면 체크리스트가 존재하지 않는다.
  return problem(
    404,
    'SUB_001',
    apiPath(context.path),
    '승인된 신청이 없어 제출 체크리스트를 만들 수 없습니다.',
  );
}

function submissionFormHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(
    context,
    'programs/:id/milestones/:milestoneId/submission-form',
  );
  if (params === null) return null;

  const form = SUBMISSION_FORMS[`${params.id}/${params.milestoneId}`];
  return form === undefined
    ? problem(
        404,
        'SUB_001',
        apiPath(context.path),
        '해당 마일스톤의 제출 양식을 찾을 수 없습니다.',
      )
    : json(200, form);
}

/**
 * 내 신청서. **반려 사유가 학생에게 닿는 유일한 경로다** — 알림 payload·감사 로그·
 * 메일 어디에도 사유가 없으므로, 이 규칙이 없으면 `/programs/{id}/apply`가 사유를
 * 그릴 재료를 못 받고 검토자는 빈 안내만 보게 된다(그동안 커버리지 목록의
 * `KNOWN_GAPS`에 있던 항목이다).
 *
 * 실패는 backend `StudentApplicationManagementService.requireContext`의 **순서까지**
 * 따라간다 — 학생 아님(403 `APP_008`) → 프로그램 없음(404 `APP_009`) → 신청 없음
 * (404 `APP_001`). 픽스처가 순서를 바꾸면 없는 프로그램을 열었을 때 화면이 "신청이
 * 사라졌습니다"로 갈려, 실제 배포에서는 나지 않는 갈래가 검토에서만 보인다.
 *
 * 401은 `unauthenticated()`를 쓴다 — 이 컨트롤러의 `SessionGuard`가 실제로 주는
 * 코드(`AUT_003`)다.
 */
function myApplicationHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:programId/applications/me');
  if (params === null) return null;
  if (!context.isAuthenticated) return unauthenticated(context.path);
  if (context.role !== 'STUDENT') {
    return problem(
      403,
      'APP_008',
      apiPath(context.path),
      '승인된 학생 계정만 신청할 수 있습니다.',
    );
  }

  const programId = params.programId ?? '';
  // 위쪽 `PROGRAM_NOT_FOUND_CODE`를 쓰지 않는다 — 그 문자열은 programs 모듈 규칙들이
  // 쓰는 값이고, 이 엔드포인트의 "프로그램 없음"은 applications 모듈이
  // `APP_009`로 낸다(`applications-error-code.enum.ts`).
  if (!isPublicProgramId(programId)) {
    return problem(
      404,
      'APP_009',
      apiPath(context.path),
      '프로그램을 찾을 수 없습니다.',
    );
  }

  const application = MY_APPLICATION_FIXTURES[programId];
  // 신청 전이거나 이 페르소나의 신청이 없는 프로그램 — 화면은 이때 신청 양식으로 간다.
  return application === undefined
    ? problem(404, 'APP_001', apiPath(context.path), '신청을 찾을 수 없습니다.')
    : json(200, application);
}

function myTeamHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:id/teams/me');
  if (params === null) return null;

  const team = MY_TEAM_FIXTURES[params.id ?? ''];
  // 팀이 없으면 404다 — 화면은 이때 팀 만들기·참여코드 합류 화면을 보여준다.
  return team === undefined
    ? notFound('TEAM_010', context.path)
    : json(200, team);
}

/** 재제출 revision은 체크리스트의 현재 revision 다음 값이어야 화면 문구가 맞는다. */
const NEXT_RESUBMISSION_REVISIONS: Readonly<Record<string, number>> = {
  'submission-revision': 2,
  'submission-contest-revision': 3,
};

function studentMutationHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (context.method !== 'POST') return null;

  const applicationParams = matchPath(
    'programs/:id/applications',
    context.path,
  );
  if (applicationParams !== null) {
    // 저장소 연결 필드를 에코해 브라우저 QA가 제출 payload를 확인할 수 있게 한다.
    // 한계: 신청 내용은 저장되지 않아 다시 열면 픽스처의 신청 전 상태로 돌아온다.
    //
    // 팀은 **요청 본문에서 읽지 않는다.** backend 는 신청자의 팀 멤버십으로 팀을 정하고
    // (`applications.service.ts` 의 `findExistingTeamMembership`) 요청 본문의 `teamId` 는
    // 미허용 키라 400 SYS_003 이 된다. 예전에는 여기서 `teamId` 를 그대로 에코했고, 그
    // 바람에 **frontend 가 미허용 키를 보내는 동안에도 로컬 검토는 성공처럼 보였다** —
    // 2026-08-05 부터 배포 운영에서 모든 신규 신청이 실패한 회귀가 여기서 가려졌다.
    // 픽스처는 실제 계약보다 너그러우면 안 된다.
    const repositoryConnectionMode =
      bodyEnum(context, 'repositoryConnectionMode', ['NEW', 'OWN'] as const) ??
      'NEW';
    const applicationBody = bodyRecord(context);
    if (applicationBody !== null && 'teamId' in applicationBody) {
      return problem(
        400,
        'SYS_003',
        apiPath(context.path),
        'property teamId should not exist',
      );
    }
    return accepted({
      id: 'synthetic-application-basic',
      programId: applicationParams.id,
      status: 'SUBMITTED',
      teamId: 'synthetic-team-basic',
      submittedAt: '2026-08-01T00:00:00.000Z',
      repositoryConnectionMode,
      repositoryUrl:
        repositoryConnectionMode === 'OWN'
          ? (bodyNullableString(context, 'repositoryUrl') ??
            bodyString(context, 'repositoryUrl'))
          : null,
    });
  }

  if (matchPath('programs/:id/teams', context.path) !== null) {
    // 화면은 이 응답의 이름과 참여코드를 그대로 명단 화면에 그린다 — 방금 입력한
    // 팀명을 되돌려 준다. 한계: 저장되지 않아 다시 열면 팀 없음 상태로 돌아온다.
    return accepted({
      id: 'synthetic-team-created',
      name: bodyString(context, 'name') ?? '합성 신규 팀',
      joinCode: 'FIXTURE01',
      memberCount: 1,
    });
  }

  if (matchPath('programs/:id/teams/join', context.path) !== null) {
    return accepted(JOINED_TEAM_FIXTURE);
  }

  if (context.path === 'submissions') {
    return accepted({
      submissionId: 'synthetic-submission-01',
      status: 'SUBMITTED',
      submittedAt: '2026-08-01T00:00:00.000Z',
    });
  }

  if (context.path === 'submission-files') {
    return accepted({
      fileId: 'synthetic-file-01',
      fileName: 'synthetic-submission.pdf',
      contentType: 'application/pdf',
      size: 20_480,
      expiresAt: '2026-08-01T01:00:00.000Z',
    });
  }

  const resubmissionParams = matchPath(
    'submissions/:submissionId/resubmissions',
    context.path,
  );
  if (resubmissionParams !== null) {
    const submissionId = resubmissionParams.submissionId ?? '';
    return accepted({
      submissionId,
      revision: NEXT_RESUBMISSION_REVISIONS[submissionId] ?? 2,
      status: 'SUBMITTED',
    });
  }

  return null;
}

export const STUDENT_HANDLERS: readonly LocalReviewHandler[] = [
  studentJourneyFallbackHandler,
  applicationTemplatesHandler,
  activityTimelineHandler,
  applicationDecisionNotificationsHandler,
  programViewerHandler,
  programActivityHandler,
  submissionChecklistHandler,
  submissionFormHandler,
  myApplicationHandler,
  myTeamHandler,
  studentMutationHandler,
  // 2 세그먼트 `programs/{id}`는 다른 규칙을 가리기 쉬우므로 마지막에 둔다.
  publicProgramDetailHandler,
];
