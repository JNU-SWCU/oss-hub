import type { ActivityGranularity } from '@/features/activity-timeline/types';
import type { ProgramTeam, TeamMember } from '@/features/programs/api';
import { PROGRAM_TEMPLATE_DEFINITIONS } from '@/features/programs/program-templates';
import type { StudentApplication } from '@/features/programs/student-application-api';
import type { SentTeamInvitation } from '@/features/programs/team-invitation-api';
import { apiPath } from '@/lib/api-client';
import {
  accepted,
  bodyEnum,
  bodyNullableString,
  bodyRecord,
  bodyString,
  json,
  localReviewSessionState,
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
import { myProfileFixtureFor } from './account-handlers';
import {
  MY_TEAM_FIXTURES,
  PROGRAM_CHECKLISTS,
  SUBMISSION_FORMS,
  isPublicProgramId,
  myApplicationFor,
  programActivityFor,
  programDetailFor,
} from './student-program-fixtures';
import { sentInvitationsFor } from './team-invitation-fixtures';

/**
 * 학생 동선의 로컬 검토 응답.
 * 담당 경로: `programs/{id}/viewer|activity|submissions/me|teams/me`,
 * `programs/{id}/teams/me/members/{userId}`(팀장의 팀원 제외),
 * `programs/application-templates`, `programs/{id}/milestones/{id}/submission-form`,
 * `dashboard/student*`, 학생 조작(신청·팀·제출·재제출).
 *
 * `fixture-response.ts`가 `student` 페르소나에 한해 `STUDENT_JOURNEY_RESPONSES`를 먼저
 * 시도한다. 여기서는 그 규칙이 응답하지 못한 경우만 채운다.
 */

const PROGRAM_NOT_FOUND_CODE = 'PROGRAM_NOT_FOUND';
const CURRENT_SYNTHETIC_USER = {
  userId: 'synthetic-user-01',
  nickname: 'synthetic-contributor-01',
} as const;

const SYNTHETIC_MUTATION_AT = '2026-08-01T00:00:00.000Z';

export function currentSyntheticUserId(): string {
  return CURRENT_SYNTHETIC_USER.userId;
}

function currentSyntheticMember(isLeader: boolean): TeamMember {
  return {
    userId: CURRENT_SYNTHETIC_USER.userId,
    nickname: CURRENT_SYNTHETIC_USER.nickname,
    name: myProfileFixtureFor('student').name,
    isLeader,
  };
}

/**
 * 팀 능력 플래그를 **읽을 때 다시 계산한다** — backend
 * `ProgramTeamsService.toTeamView`와 같은 규칙이다(`canInvite`는 팀장,
 * `canRemoveMembers`는 팀장이면서 팀원이 둘 이상, `canLeave`는 혼자가 아니거나
 * 신청 기록이 없을 때).
 *
 * 저장해 둔 플래그를 그대로 돌려주면 팀원 제외·신청 제출 뒤에 예전 값이 남아,
 * 화면이 서버가 거절할 버튼을 그리거나 있는 권한을 숨긴다. 한 자리에서 파생시켜
 * 쓰는 쪽들(팀 만들기·초대 수락·팀원 제외)이 각자 같은 규칙을 다시 적지 않게 한다.
 */
export function teamWithCapabilities(
  programId: string,
  team: Pick<
    ProgramTeam,
    'id' | 'name' | 'minMembers' | 'maxMembers' | 'members' | 'isLeader'
  >,
): ProgramTeam {
  const viewer = team.members.find(
    (member) => member.userId === currentSyntheticUserId(),
  );
  // 명단에 내가 없는 팀(아직 붙지 않은 초대 목적지)은 적혀 온 값을 그대로 믿는다.
  const isLeader = viewer === undefined ? team.isLeader : viewer.isLeader;
  const hasApplication = storedApplication(programId)?.teamId === team.id;
  const memberCount = team.members.length;
  return {
    ...team,
    memberCount,
    hasApplication,
    isLeader,
    canInvite: isLeader,
    canRemoveMembers: isLeader && memberCount > 1,
    canLeave: memberCount > 1 || !hasApplication,
  };
}

export function resolveProgramTeam(programId: string): ProgramTeam | null {
  const { programTeams } = localReviewSessionState();
  const stored =
    programId in programTeams
      ? (programTeams[programId] ?? null)
      : (MY_TEAM_FIXTURES[programId] ?? null);
  return stored === null ? null : teamWithCapabilities(programId, stored);
}

/**
 * 본인이 나간 뒤 남는 명단. 팀장이 나가면 남은 명단의 **첫 사람**이 승계한다 —
 * backend `ProgramTeamsRepository.leave`가 합류 순서(`createdAt`, `id`)로 고르는 그
 * 사람이고, 픽스처 명단은 이미 그 순서다. 비어 있으면 1인 팀이라 팀 자체가 사라진다.
 *
 * 승계 결과는 나간 사람의 화면에 남지 않는다(나가면 무덤이 `null`이다). 규칙을
 * 이 한 자리에 두어 「팀은 남고 팀장만 바뀐다」와 「1인 미제출 팀만 사라진다」가
 * 같은 재료에서 나오게 한다.
 */
export function rosterAfterLeave(team: ProgramTeam): readonly TeamMember[] {
  const remaining = team.members.filter(
    (member) => member.userId !== currentSyntheticUserId(),
  );
  if (remaining.some((member) => member.isLeader)) return remaining;
  return remaining.map((member, index) =>
    index === 0 ? { ...member, isLeader: true } : member,
  );
}

export function rememberProgramTeam(
  programId: string,
  team: ProgramTeam | null,
): void {
  localReviewSessionState().programTeams[programId] = team;
}

export function findOwnedTeamById(
  teamId: string,
): { readonly programId: string; readonly team: ProgramTeam } | null {
  const { programTeams } = localReviewSessionState();
  for (const [programId, team] of Object.entries(programTeams)) {
    if (team?.id === teamId) {
      return { programId, team: teamWithCapabilities(programId, team) };
    }
  }
  for (const [programId, team] of Object.entries(MY_TEAM_FIXTURES)) {
    if (programId in programTeams) continue;
    if (team.id === teamId) {
      return { programId, team: teamWithCapabilities(programId, team) };
    }
  }
  return null;
}

/** 세션에 기록된 신청 원본. 팀을 떠난 뒤에도 이 기록은 지우지 않는다. */
function storedApplication(programId: string): StudentApplication | null {
  const { programApplications } = localReviewSessionState();
  if (programId in programApplications) {
    return programApplications[programId] ?? null;
  }
  return isPublicProgramId(programId) ? myApplicationFor(programId) : null;
}

/**
 * 화면이 볼 수 있는 내 신청. 신청은 **그 신청을 낸 팀의 현재 구성원에게만** 보인다.
 *
 * 탈퇴해도 신청·제출 기록 자체는 남아 있어야 한다 — backend는 팀이 낸 신청을
 * 지우거나 옮기지 않고, 남은 팀원의 참여 상태도 그대로다. 대신 나간 사람의
 * 참여자 응답(내 신청서·상세 뷰어·제출 체크리스트)이 그 기록을 더 이상 드러내지
 * 않는다. 기록을 지워 버리면 「팀은 남았는데 신청은 사라졌다」는, 실제 서버가
 * 만들 수 없는 상태가 된다.
 *
 * ⚠ 「팀이 없는 신청은 그냥 보여 준다」는 예외를 두지 않는다. 지금 모든 신청은
 * 팀이 내므로(혼자면 1인 팀이 생긴다, #1269) 그 예외는 소속 없는 사람에게
 * 참여자 권한을 되돌려주는 폴백이 된다. 대신 신청이 있는 프로그램에는 항상 팀
 * 픽스처를 둔다(`MY_TEAM_FIXTURES` 주석).
 */
export function visibleApplication(
  programId: string,
): StudentApplication | null {
  const application = storedApplication(programId);
  if (application === null) return null;
  const team = resolveProgramTeam(programId);
  return team !== null && team.id === application.teamId ? application : null;
}

/**
 * 미제출 1인 팀이 사라질 때 대기 중인 보낸 초대를 함께 정리한다 — backend도 팀
 * 삭제 전에 `teamInvitation`을 먼저 지운다. 고정 픽스처에만 있는 초대도 같이
 * 무덤을 남겨야 목록이 삭제된 팀의 초대를 다시 그리지 않는다.
 */
function cancelSentInvitationsFor(teamId: string): void {
  const { sentInvitationsByTeam } = localReviewSessionState();
  const cleared: Record<string, SentTeamInvitation | null> = {};
  for (const invitationId of Object.keys(sentInvitationsByTeam[teamId] ?? {})) {
    cleared[invitationId] = null;
  }
  for (const invitation of sentInvitationsFor(teamId)) {
    cleared[invitation.id] = null;
  }
  sentInvitationsByTeam[teamId] = cleared;
}

function rememberApplication(
  programId: string,
  application: StudentApplication | null,
): void {
  localReviewSessionState().programApplications[programId] = application;
}

function teamLimitsFor(programId: string): {
  readonly minMembers: number | null;
  readonly maxMembers: number;
} {
  const fixtureTeam = MY_TEAM_FIXTURES[programId];
  if (fixtureTeam !== undefined) {
    return {
      minMembers: fixtureTeam.minMembers,
      maxMembers: fixtureTeam.maxMembers,
    };
  }
  if (programId === 'program-basic-study') {
    return { minMembers: 1, maxMembers: 4 };
  }
  if (programId === 'program-oss-contest') {
    return { minMembers: 2, maxMembers: 4 };
  }
  return { minMembers: 1, maxMembers: 4 };
}

function createdTeamIdFor(programId: string): string {
  return `synthetic-team-${programId}`;
}

/**
 * 학생 동선 픽스처를 다른 학생 역할 페르소나(`settings`·`wrong-role`)에도 그대로
 * 준다. 같은 데이터를 두 벌 적으면 한쪽만 고쳐져 화면이 어긋난다.
 */
function studentJourneyFallbackHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (context.method !== 'GET' || context.role !== 'STUDENT') return null;
  const viewerParams = matchPath('programs/:id/viewer', context.path);
  if (
    viewerParams !== null &&
    (viewerParams.id ?? '') in localReviewSessionState().programApplications
  ) {
    return null;
  }
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
  if (!isPublicProgramId(programId)) {
    return notFound(PROGRAM_NOT_FOUND_CODE, context.path);
  }

  const detail = programDetailFor(programId, context.role);
  const { programApplications } = localReviewSessionState();
  if (context.role !== 'STUDENT' || !(programId in programApplications)) {
    return json(200, detail);
  }

  // 팀을 떠난 뒤에는 그 팀의 신청 상태를 더 이상 말하지 않는다 — 신청 기록은
  // 남아 있지만 나간 사람은 더 이상 그 신청의 참여자가 아니다.
  return json(200, {
    ...detail,
    viewer: {
      ...detail.viewer,
      applicationStatus: visibleApplication(programId)?.status ?? null,
    },
  });
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

  /*
    승인된 신청이 없을 때의 실패를 **백엔드와 같은 코드·상태로** 답한다
    (`submissions.service.ts`의 `requireApprovedApplication`) — 신청이 아예 없으면
    403 `SUB_003`, 냈지만 아직 승인되지 않았으면 403 `SUB_004`다.

    예전에는 `404 SUB_001`을 줬는데 그 조합은 실제 서버가 만들 수 없다 — `SUB_001`은
    「학생 계정만 제출할 수 있습니다」(403)라서, 검토자가 로컬에서 본 화면과 배포에서
    나는 화면이 서로 다른 갈래였다. 참여자 아님 안내(#1099)가 이 경로로 도달한다.
  */
  const applied = visibleApplication(programId) !== null;
  return applied
    ? problem(
        403,
        'SUB_004',
        apiPath(context.path),
        '승인된 신청만 제출할 수 있습니다.',
      )
    : problem(
        403,
        'SUB_003',
        apiPath(context.path),
        '해당 신청의 제출 권한이 없습니다.',
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

  const application = visibleApplication(programId);
  // 신청 전인 프로그램 — 화면은 이때 신청 양식으로 간다. 팀을 떠난 뒤도 같다.
  return application === null
    ? problem(404, 'APP_001', apiPath(context.path), '신청을 찾을 수 없습니다.')
    : json(200, application);
}

function myTeamHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'programs/:id/teams/me');
  if (params === null) return null;

  const team = resolveProgramTeam(params.id ?? '');
  // 팀이 없으면 404다 — 화면은 이때 팀 만들기 화면을 보여준다.
  return team === null ? notFound('TEAM_010', context.path) : json(200, team);
}

/** 재제출 revision은 체크리스트의 현재 revision 다음 값이어야 화면 문구가 맞는다. */
const NEXT_RESUBMISSION_REVISIONS: Readonly<Record<string, number>> = {
  'submission-revision': 2,
  'submission-contest-revision': 3,
};

function studentMutationHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const applicationMeParams = matchPath(
    'programs/:id/applications/me',
    context.path,
  );
  if (applicationMeParams !== null && context.method === 'DELETE') {
    if (!context.isAuthenticated) return unauthenticated(context.path);
    if (context.role !== 'STUDENT') {
      return problem(
        403,
        'APP_008',
        apiPath(context.path),
        '승인된 학생 계정만 신청할 수 있습니다.',
      );
    }
    const programId = applicationMeParams.id ?? '';
    if (!isPublicProgramId(programId)) {
      return problem(
        404,
        'APP_009',
        apiPath(context.path),
        '프로그램을 찾을 수 없습니다.',
      );
    }
    const existing = visibleApplication(programId);
    if (existing === null) {
      return problem(
        404,
        'APP_001',
        apiPath(context.path),
        '신청을 찾을 수 없습니다.',
      );
    }
    if (!existing.canCancel) {
      return problem(
        409,
        'APP_002',
        apiPath(context.path),
        '이미 판정된 신청은 취소할 수 없습니다.',
      );
    }
    // 팀은 그대로 둔다 — 신청을 취소해도 팀이 사라지지 않고, 능력 플래그는
    // 읽을 때 다시 계산되므로 여기서 팀 행을 고쳐 둘 이유가 없다.
    rememberApplication(programId, null);
    return accepted({ cancelled: true });
  }

  const teamMeParams = matchPath('programs/:id/teams/me', context.path);
  if (teamMeParams !== null && context.method === 'DELETE') {
    if (!context.isAuthenticated) return unauthenticated(context.path);
    if (context.role !== 'STUDENT') {
      return problem(
        403,
        'TEAM_001',
        apiPath(context.path),
        '승인된 학생 계정만 팀을 구성할 수 있습니다.',
      );
    }
    // backend `leave`는 프로그램을 따로 찾지 않는다 — 소속이 없으면 없는 프로그램도
    // 같은 TEAM_010이다. 여기서만 TEAM_002를 주면 배포에서는 나지 않는 갈래가 생긴다.
    const programId = teamMeParams.id ?? '';
    const team = resolveProgramTeam(programId);
    if (team === null) return notFound('TEAM_010', context.path);
    /*
      탈퇴는 신청을 낸 뒤에도, 신청 기간이 닫힌 뒤에도 된다 — 막는 것은 하나뿐이다:
      신청 기록이 있는 팀의 마지막 구성원(TEAM_012). 예전의 「제출 후 동결(TEAM_008)」·
      「팀원이 남으면 삭제 불가(TEAM_011)」는 은퇴한 코드라 더 이상 내려오지 않는다.
    */
    const remaining = rosterAfterLeave(team);
    if (remaining.length === 0) {
      if (team.hasApplication) {
        return problem(
          409,
          'TEAM_012',
          apiPath(context.path),
          '신청 기록이 있는 팀의 마지막 구성원은 나갈 수 없습니다.',
        );
      }
      // 미제출 1인 팀만 팀 자체가 사라진다. 대기 중인 초대도 함께 정리한다.
      cancelSentInvitationsFor(team.id);
    }
    /*
      나간 자리에는 `null` 무덤을 남긴다 — 고정 픽스처가 다시 살아나면 방금 나간 팀의
      명단·초대가 그대로 다시 열려, 서버가 이미 거둘 접근이 화면에는 남는다.
      팀이 남는 경우(`remaining.length > 0`)의 승계는 남은 사람들의 사실이라 나간
      사람의 화면에는 나타나지 않고, 그 팀의 신청·제출·보낸 초대는 그대로 둔다.
    */
    rememberProgramTeam(programId, null);
    return accepted();
  }

  /*
    팀장의 팀원 제외. 판정 순서는 backend `ProgramTeamsRepository.removeMember`와
    같다 — 소속(TEAM_010) → 팀장 여부(TEAM_013) → 본인 대상(TEAM_014) → 대상 존재
    (TEAM_015). 권한을 먼저 보는 것이 중요하다: 팀장이 아닌 사람에게는 대상의 존재
    여부를 알리지 않는다. 제외는 명단만 바꿀 뿐, 이미 난 신청·제출 기록은 지우지
    않는다.
  */
  const teamMemberParams = matchPath(
    'programs/:id/teams/me/members/:userId',
    context.path,
  );
  if (teamMemberParams !== null && context.method === 'DELETE') {
    if (!context.isAuthenticated) return unauthenticated(context.path);
    if (context.role !== 'STUDENT') {
      return problem(
        403,
        'TEAM_001',
        apiPath(context.path),
        '승인된 학생 계정만 팀을 구성할 수 있습니다.',
      );
    }
    const programId = teamMemberParams.id ?? '';
    const team = resolveProgramTeam(programId);
    if (team === null) return notFound('TEAM_010', context.path);
    if (!team.isLeader) {
      return problem(
        403,
        'TEAM_013',
        apiPath(context.path),
        '팀장만 팀원을 제외할 수 있습니다.',
      );
    }
    const targetUserId = teamMemberParams.userId ?? '';
    if (targetUserId === currentSyntheticUserId()) {
      return problem(
        409,
        'TEAM_014',
        apiPath(context.path),
        '본인은 제외할 수 없습니다. 팀 나가기를 사용해 주세요.',
      );
    }
    const members = team.members.filter(
      (member) => member.userId !== targetUserId,
    );
    if (members.length === team.members.length) {
      return problem(
        404,
        'TEAM_015',
        apiPath(context.path),
        '해당 팀원을 찾을 수 없습니다.',
      );
    }
    rememberProgramTeam(programId, {
      ...team,
      memberCount: members.length,
      members,
    });
    return accepted();
  }

  if (context.method !== 'POST') return null;

  const applicationParams = matchPath(
    'programs/:id/applications',
    context.path,
  );
  if (applicationParams !== null) {
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
    const programId = applicationParams.id ?? '';
    if (!isPublicProgramId(programId)) {
      return problem(
        404,
        'APP_009',
        apiPath(context.path),
        '프로그램을 찾을 수 없습니다.',
      );
    }
    if (visibleApplication(programId) !== null) {
      return problem(
        409,
        'APP_011',
        apiPath(context.path),
        '이미 이 프로그램에 신청했습니다.',
      );
    }
    const team = resolveProgramTeam(programId);
    if (team === null) {
      return problem(
        403,
        'APP_014',
        apiPath(context.path),
        '해당 팀의 구성원만 신청할 수 있습니다.',
      );
    }
    /*
      팀의 신청은 한 건이고 그 제출 권한은 **현재 팀장**에게만 있다(#1269,
      backend `applications.service.ts`의 `lockTeamForApply` → APP_028). 초대를 받아
      합류한 팀원은 따로 신청하지 않으므로, 픽스처가 여기를 열어 두면 배포에서는
      403으로 막힐 화면이 로컬에서만 성공처럼 보인다.
    */
    if (!team.isLeader) {
      return problem(
        403,
        'APP_028',
        apiPath(context.path),
        '팀장만 팀 신청을 제출할 수 있습니다.',
      );
    }
    const program = programDetailFor(programId, 'STUDENT');
    const application: StudentApplication = {
      id: `synthetic-application-${programId}`,
      programId,
      status: 'SUBMITTED',
      teamId: team.id,
      answers: {
        applicantName: myProfileFixtureFor('student').name,
        title: `${program.name} 참여 신청`,
      },
      submittedAt: SYNTHETIC_MUTATION_AT,
      updatedAt: SYNTHETIC_MUTATION_AT,
      isRepositoryPublicationPlanned: program.repositoryProvisioningEnabled,
      rejectionReason: null,
      isManager: true,
      canManage: true,
      canEdit: true,
      canCancel: true,
    };
    /*
      신청을 낸다고 팀이 얼지 않는다 — 보낸 초대도, 초대 권한도, 팀원 제외도 그대로다.
      `hasApplication`은 이 신청이 가리키는 `teamId`에서 파생되므로 따로 적지 않는다.
    */
    rememberApplication(programId, application);
    return accepted({
      id: application.id,
      programId,
      status: 'SUBMITTED',
      teamId: team.id,
      submittedAt: SYNTHETIC_MUTATION_AT,
      repositoryConnectionMode,
      repositoryUrl:
        repositoryConnectionMode === 'OWN'
          ? (bodyNullableString(context, 'repositoryUrl') ??
            bodyString(context, 'repositoryUrl'))
          : null,
    });
  }

  const teamCreateParams = matchPath('programs/:id/teams', context.path);
  if (teamCreateParams !== null) {
    const programId = teamCreateParams.id ?? '';
    if (!isPublicProgramId(programId)) {
      return problem(
        404,
        'TEAM_002',
        apiPath(context.path),
        '프로그램을 찾을 수 없습니다.',
      );
    }
    /*
      본문 검사가 소속 검사보다 **먼저**다 — backend도 `CreateTeamRequestDto`를
      컨트롤러 경계에서 검사한 뒤에야 서비스의 소속 판정으로 들어간다. 순서를
      바꾸면 빈 이름으로 보내도 「이미 팀에 소속됨」이 돌아와, 검토자가 보는 입력
      오류 문구가 배포와 갈린다. 중복 소속 가드는 그대로 가지고 가고 뒤에서 본다.
    */
    const name = bodyString(context, 'name')?.trim() ?? '';
    if (name === '') {
      return problem(
        400,
        'SYS_003',
        apiPath(context.path),
        'name should not be empty',
      );
    }
    const existing = resolveProgramTeam(programId);
    if (existing !== null) {
      return problem(
        409,
        'TEAM_006',
        apiPath(context.path),
        '이미 이 프로그램의 팀에 소속되어 있습니다.',
      );
    }
    const limits = teamLimitsFor(programId);
    const members = [currentSyntheticMember(true)];
    // 만든 직후의 팀 — 만든 사람이 팀장이고(초대 가능), 혼자라 제외할 상대가 없고,
    // 아직 신청 기록이 없어 그대로 나갈(=팀을 지울) 수 있다.
    const team: ProgramTeam = {
      id: createdTeamIdFor(programId),
      name,
      memberCount: members.length,
      minMembers: limits.minMembers,
      maxMembers: limits.maxMembers,
      hasApplication: false,
      canInvite: true,
      canRemoveMembers: false,
      canLeave: true,
      isLeader: true,
      members,
    };
    rememberProgramTeam(programId, team);
    return accepted({
      id: team.id,
      name: team.name,
      joinCode: 'FIXTURE01',
      memberCount: team.memberCount,
    });
  }

  if (context.path === 'submissions') {
    return accepted({
      submissionId: 'synthetic-submission-01',
      status: 'SUBMITTED',
      submittedAt: SYNTHETIC_MUTATION_AT,
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
