import {
  PROGRAM_CATEGORIES,
  PROGRAM_TEMPLATE_DEFINITIONS,
  type ProgramCategory,
} from '@/features/programs/program-templates';
import type {
  ApplicationListItem,
  ApplicationListPage,
  StaffTeamDetail,
  SubmissionType,
} from '@/features/programs/types';
import type { ReviewDecision } from '@/features/reviews/types';
import type {
  MatrixRow,
  SubmissionMatrixPage,
} from '@/features/submissions/types';
import {
  accepted,
  bodyEnum,
  bodyNullableString,
  bodyString,
  json,
  matchGet,
  matchPath,
  notFound,
  positiveIntParam,
  type LocalReviewContext,
  type LocalReviewHandler,
} from '../handler-kit';
import { staffProgramTeamDirectoryFor } from './program-overview-fixtures';
import { isPublicProgramId } from './student-program-fixtures';
import {
  CREATED_PROGRAM_ID,
  findApplicationByTeamId,
  findStaffMilestone,
  findStaffApplication,
  findStaffProgram,
  STAFF_REVIEW_CONTEXTS,
  type StaffProgramFixture,
} from './staff-program-fixtures';

/**
 * 교직원 운영 동선의 로컬 검토 응답.
 * 담당 경로: `dashboard/staff/*`, `programs/{id}/edit|applications|submissions/matrix`,
 * `submissions/{id}/review-context`, 프로그램 생성·수정·마일스톤·신청 처리·검토 저장.
 *
 * 교직원 화면이므로 `staff`·`admin` 페르소나에만 응답한다. 나머지 페르소나는
 * `null`을 돌려 기본 404로 떨어뜨린다 — 권한 없는 역할까지 화면이 뜨면 역할
 * 가드 자체가 검토되지 않는다.
 *
 * 신청자 목록 화면이 함께 읽는 `programs/{id}/viewer`는 학생 동선 핸들러가
 * 모든 역할에 응답한다(교직원 페르소나에도 `viewer.role: STAFF`로 답한다).
 * 같은 경로를 여기서 또 다루면 절대 실행되지 않는 규칙만 남는다.
 */

type StaffRole = 'STAFF' | 'ADMIN';

function staffRole(context: LocalReviewContext): StaffRole | null {
  return context.role === 'STAFF' || context.role === 'ADMIN'
    ? context.role
    : null;
}

/** 조작(POST/PATCH/DELETE)은 method까지 일치해야 한다 — GET 전용 matchGet의 짝. */
function matchMethod(
  context: LocalReviewContext,
  method: string,
  pattern: string,
): Record<string, string> | null {
  return context.method === method ? matchPath(pattern, context.path) : null;
}

function matchesApplicationFilters(
  item: ApplicationListItem,
  search: string,
  status: string,
): boolean {
  const haystack = [
    item.answers.applicantName,
    item.answers.title,
    item.applicant.name ?? '',
    item.applicant.nickname,
    item.team?.name ?? '',
  ]
    .join(' ')
    .toLocaleLowerCase('ko');
  return (
    haystack.includes(search) && (status === 'all' || item.status === status)
  );
}

function applicationListPage(
  items: readonly ApplicationListItem[],
  searchParams: URLSearchParams,
): ApplicationListPage {
  const page = positiveIntParam(searchParams.get('page'), 1);
  const pageSize = positiveIntParam(searchParams.get('pageSize'), 20);
  const search = (searchParams.get('search') ?? '')
    .trim()
    .toLocaleLowerCase('ko');
  const status = searchParams.get('status') ?? 'all';
  const matched = items.filter((item) =>
    matchesApplicationFilters(item, search, status),
  );
  const offset = (page - 1) * pageSize;

  return {
    items: matched.slice(offset, offset + pageSize),
    page,
    pageSize,
    totalItems: matched.length,
    totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
  };
}

/** 매트릭스 검색은 행 제목과 GitHub 핸들을 함께 훑는다(#124 q 계약). */
function matchesMatrixQuery(row: MatrixRow, query: string): boolean {
  if (query === '') return true;
  return [row.displayName, ...row.githubLogins]
    .join(' ')
    .toLocaleLowerCase('ko')
    .includes(query);
}

function submissionMatrixPage(
  fixture: StaffProgramFixture,
  searchParams: URLSearchParams,
): SubmissionMatrixPage {
  const page = positiveIntParam(searchParams.get('page'), 1);
  const pageSize = positiveIntParam(searchParams.get('pageSize'), 20);
  const query = (searchParams.get('q') ?? '').trim().toLocaleLowerCase('ko');
  // D6: applicationMode 형태 필터는 폐지 — 값이 와도 무시한다.
  const matched = fixture.matrixRows.filter((row) =>
    matchesMatrixQuery(row, query),
  );
  const offset = (page - 1) * pageSize;

  return {
    milestones: fixture.program.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt,
    })),
    rows: matched.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: matched.length,
  };
}

const programEditHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:id/edit');
  if (staffRole(context) === null || params === null) return null;
  const fixture = findStaffProgram(params.id as string);
  return fixture === null
    ? notFound('PRG_004', context.path)
    : json(200, fixture.program);
};

/**
 * 교직원 참여 팀 목록(QA33). 학생이 쓰는 `overview/teams`와 **다른 경로**이고 실명을
 * 포함한다 — 그쪽은 프로그램 참가자 전원에게 보이는 로스터라 nickname만 준다.
 * 학생 페르소나로는 여기 닿지 않는다(`staffRole`이 null이면 이 규칙이 응답하지 않고,
 * 학생 규칙의 `teams/me`가 세그먼트 수가 달라 서로 먹지 않는다).
 */
const staffProgramTeamsHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:id/teams');
  if (staffRole(context) === null || params === null) return null;
  const programId = params.id as string;
  return isPublicProgramId(programId)
    ? json(200, staffProgramTeamDirectoryFor(programId))
    : notFound('PRG_001', context.path);
};

/**
 * 교직원 팀 상세(#874). 목록(`staffProgramTeamsHandler`)과 같은 팀 명단에서 하나를
 * 꺼내고, 그 팀 id로 신청을 찾아 붙인다(`findApplicationByTeamId`) — 신청이 없으면
 * `application: null`(아직 신청하지 않은 팀). 없는 팀·다른 프로그램의 팀은 실제
 * 백엔드와 같은 코드(`TEAM_010`, 동일 404)로 떨어진다(`program-teams.controller.ts`
 * 주석 참고 — 이 둘을 가려 주지 않는다).
 */
const staffProgramTeamDetailHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:id/teams/:teamId');
  if (staffRole(context) === null || params === null) return null;
  const programId = params.id as string;
  const teamId = params.teamId as string;
  if (!isPublicProgramId(programId)) {
    return notFound('TEAM_010', context.path);
  }
  const team = staffProgramTeamDirectoryFor(programId).find(
    (candidate) => candidate.teamId === teamId,
  );
  if (team === undefined) return notFound('TEAM_010', context.path);

  const application = findApplicationByTeamId(teamId);
  return json(200, {
    teamId: team.teamId,
    name: team.name,
    memberCount: team.memberCount,
    members: team.members,
    application:
      application === null
        ? null
        : {
            id: application.id,
            status: application.status,
            repositoryConnectionMode: application.repositoryConnectionMode,
            repository:
              application.repository === null
                ? null
                : {
                    id: `repository-${application.id}`,
                    ...application.repository,
                    publishEligible:
                      application.repository.visibility === 'PUBLIC',
                    blockedReasons:
                      application.repository.visibility === 'PUBLIC'
                        ? []
                        : ['REPOSITORY_PUBLICATION_NOT_PLANNED'],
                  },
            repositoryProvisioning: application.repositoryProvisioning,
          },
  } satisfies StaffTeamDetail);
};

const programApplicationsHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:id/applications');
  if (staffRole(context) === null || params === null) return null;
  const fixture = findStaffProgram(params.id as string);
  return fixture === null
    ? notFound('APP_009', context.path)
    : json(
        200,
        applicationListPage(fixture.applications, context.searchParams),
      );
};

/**
 * #722 신청 상세. 없는 신청은 `APP_001` 404 다 — 픽스처가 "이 경로를 모른다"(`LFX_404`)와
 * 도메인 404 를 갈라야 검토자가 없는 결함을 만들어 읽지 않는다.
 */
const applicationDetailHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'applications/:id');
  if (staffRole(context) === null || params === null) return null;
  const application = findStaffApplication(params.id as string);
  return application === null
    ? notFound('APP_001', context.path)
    : json(200, application);
};

const submissionMatrixHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:id/submissions/matrix');
  if (staffRole(context) === null || params === null) return null;
  const fixture = findStaffProgram(params.id as string);
  return fixture === null
    ? notFound('SUB_016', context.path)
    : json(200, submissionMatrixPage(fixture, context.searchParams));
};

const reviewContextHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'submissions/:id/review-context');
  if (staffRole(context) === null || params === null) return null;
  const reviewContext = STAFF_REVIEW_CONTEXTS[params.id as string];
  // 없는 제출은 검토 화면이 "찾을 수 없음"으로 갈리도록 백엔드 코드를 맞춘다.
  return reviewContext === undefined
    ? notFound('SUB_001', context.path)
    : json(200, reviewContext);
};

/** 카테고리를 고르면 신청 양식 템플릿이 함께 정해진다(프로그램 유형 SSOT). */
function templateForCategory(category: ProgramCategory): {
  readonly key: string;
  readonly version: number;
} {
  const definition = PROGRAM_TEMPLATE_DEFINITIONS.find(
    (candidate) => candidate.category === category,
  );
  return {
    key: definition?.template.key ?? 'basic',
    version: definition?.template.version ?? 1,
  };
}

function bodyCategory(context: LocalReviewContext): ProgramCategory | null {
  return bodyEnum<ProgramCategory>(context, 'category', PROGRAM_CATEGORIES);
}

/**
 * 프로그램 등록. 요청 본문의 유형(`category`)을 그대로 반영하고, 신청 양식
 * 템플릿도 그 유형에 맞춰 돌려준다(features/programs/api.ts `createProgram`).
 *
 * 한계: **입력한 이름은 다음 화면에 나타나지 않는다.** 픽스처는 저장소가 없어
 * 이동 후 편집 화면이 읽는 `programs/program-synthetic-new/edit`는 고정 픽스처
 * (`합성 신규 프로그램`)를 준다. 이름이 바뀌는지는 실제 백엔드에서 확인해야 한다.
 *
 * 실제 백엔드는 `detailUrl`로 공개 상세(`/programs/{id}`)를 준다. 로컬 검토에서는
 * 그 화면이 공개 프로그램 목록 픽스처에만 응답해서 방금 만든 프로그램이 곧바로
 * "찾을 수 없음"으로 떨어진다. 등록 직후 마일스톤을 붙이는 게 다음 동선이기도
 * 해서, 여기서는 교직원 편집 화면으로 보낸다.
 */
const createProgramHandler: LocalReviewHandler = (context) => {
  if (staffRole(context) === null) return null;
  if (context.method !== 'POST' || context.path !== 'programs') return null;
  const category = bodyCategory(context) ?? 'BASIC';
  const template = templateForCategory(category);
  return accepted({
    id: CREATED_PROGRAM_ID,
    category,
    applicationTemplateKey: template.key,
    applicationTemplateVersion: template.version,
    detailUrl: `/programs/${CREATED_PROGRAM_ID}/edit`,
  });
};

/**
 * 프로그램 수정. 편집 화면은 응답을 그대로 폼에 다시 채우므로, 요청 본문
 * (`UpdateProgramInput`)의 값을 픽스처 위에 덮어 돌려준다 — 저장 후 화면에
 * 방금 입력한 이름·주최·기간이 남아야 저장이 된 것으로 읽힌다.
 *
 * 한계: 저장되지 않아 화면을 다시 열면 픽스처 원래 값으로 돌아온다.
 * 마일스톤 목록·카테고리 잠금은 본문에 없어 픽스처 값을 유지한다.
 */
const updateProgramHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'PATCH', 'programs/:id');
  if (staffRole(context) === null || params === null) return null;
  const fixture = findStaffProgram(params.id as string);
  if (fixture === null) return notFound('PRG_004', context.path);

  const { program } = fixture;
  const category = bodyCategory(context) ?? program.category;
  const template = templateForCategory(category);
  // 종료일은 비울 수 있다(`endAt: null`) — 안 보낸 경우와 구분한다.
  const endAt = bodyNullableString(context, 'endAt');
  return accepted({
    ...program,
    name: bodyString(context, 'name') ?? program.name,
    organizer: bodyString(context, 'organizer') ?? program.organizer,
    category,
    applicationTemplateKey: template.key,
    applicationTemplateVersion: template.version,
    applicationStartAt:
      bodyString(context, 'applicationStartAt') ?? program.applicationStartAt,
    applicationEndAt:
      bodyString(context, 'applicationEndAt') ?? program.applicationEndAt,
    endAt: endAt === undefined ? program.endAt : endAt,
    description: bodyString(context, 'description') ?? program.description,
  });
};

/**
 * 마일스톤 저장 응답. 화면은 이 결과를 목록에 그대로 끼워 넣으므로 입력한
 * 이름·마감을 되돌려 준다. 제출 형식은 새 요청에서 받지 않고
 * 기존 행의 값만 유지한다. 본문을 못 읽었을 때만 합성 기본값을 쓴다.
 */
function milestoneFrom(
  context: LocalReviewContext,
  id: string,
  fallback: {
    readonly name: string;
    readonly dueAt: string;
    readonly submissionType: SubmissionType | null;
    readonly instructions: string | null;
  },
) {
  // 안내를 비운 채 저장하면 `null`이 온다 — 안 보낸 경우와 구분해 그대로 반영한다.
  const instructions = bodyNullableString(context, 'instructions');
  return {
    id,
    name: bodyString(context, 'name') ?? fallback.name,
    dueAt: bodyString(context, 'dueAt') ?? fallback.dueAt,
    submissionType: fallback.submissionType,
    instructions:
      instructions === undefined ? fallback.instructions : instructions,
  };
}

/** 한계: 저장되지 않아 화면을 다시 열면 추가한 마일스톤은 사라진다. */
const createMilestoneHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'POST', 'programs/:id/milestones');
  if (staffRole(context) === null || params === null) return null;
  const programId = params.id as string;
  if (findStaffProgram(programId) === null) {
    return notFound('PRG_004', context.path);
  }
  return accepted(
    milestoneFrom(context, `milestone-synthetic-${programId}`, {
      name: '합성 마일스톤',
      dueAt: '2026-12-24T14:59:59.000Z',
      submissionType: null,
      instructions:
        '[로컬 검토용] 방금 추가한 마일스톤 자리입니다. 입력값은 저장되지 않습니다.',
    }),
  );
};

/** 한계: 저장되지 않아 화면을 다시 열면 수정 전 값으로 돌아온다. */
const updateMilestoneHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'PATCH', 'milestones/:id');
  if (staffRole(context) === null || params === null) return null;
  const milestoneId = params.id as string;
  return accepted(
    milestoneFrom(
      context,
      milestoneId,
      findStaffMilestone(milestoneId) ?? {
        name: '합성 마일스톤',
        dueAt: '2026-12-24T14:59:59.000Z',
        submissionType: null,
        instructions:
          '[로컬 검토용] 합성 마일스톤입니다. 입력값은 저장되지 않습니다.',
      },
    ),
  );
};

const deleteMilestoneHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'DELETE', 'milestones/:id');
  if (staffRole(context) === null || params === null) return null;
  return accepted({ deleted: true });
};

/**
 * 신청 판정. 승인·반려·되돌리기는 요청 본문의 `action`으로 갈린다
 * (features/programs/api.ts `ApplicationDecisionInput`). 반려는 저장소 작업 없이
 * 입력한 사유를 담은 `REJECTED` 응답이어야 화면 안내가 "반려 결과"로 바뀐다.
 * 되돌리기는 `SUBMITTED`로 돌려 다시 판정할 수 있게 한다.
 *
 * 한계: 판정은 저장되지 않아 판정 직후 다시 불러오는 신청자 목록은 픽스처 원래
 * 상태를 그대로 보여준다. 기초 스터디 픽스처에는 승인·반려 행이 있어 되돌리기
 * 버튼을 브라우저에서 바로 확인할 수 있다.
 */
const decideApplicationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'PATCH', 'applications/:id');
  if (staffRole(context) === null || params === null) return null;
  const applicationId = params.id as string;
  const action = bodyString(context, 'action');
  // 본문을 못 읽으면 승인으로 본다 — 저장소 작업 상태까지 보이는 쪽이 기본이다.
  if (action === 'REJECT') {
    return accepted({
      applicationId,
      status: 'REJECTED',
      rejectionReason: bodyString(context, 'reason') ?? '',
    });
  }
  if (action === 'REVERT') {
    return accepted({
      applicationId,
      status: 'SUBMITTED',
    });
  }
  return accepted({
    applicationId,
    status: 'APPROVED',
    repositoryProvisioning: {
      enabled: true,
      jobStatus: 'SUCCEEDED',
      updatedAt: '2026-07-31T00:00:00.000Z',
      safeErrorClass: null,
    },
  });
};

const REVIEW_DECISIONS: readonly ReviewDecision[] = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
];

/**
 * 제출물 검토. 승인·보완요청·반려는 요청 본문의 `decision`에 있다
 * (features/reviews/types.ts `CreateReviewRequest`).
 *
 * 한계: 검토 결과는 저장되지 않아 검토 화면을 다시 열면 픽스처 상태로 돌아온다.
 */
const createReviewHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'POST', 'submissions/:id/reviews');
  if (staffRole(context) === null || params === null) return null;
  return accepted({
    reviewId: `synthetic-review-${params.id as string}`,
    submissionStatus:
      bodyEnum<ReviewDecision>(context, 'decision', REVIEW_DECISIONS) ??
      'APPROVED',
  });
};

const publishRepositoryHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(context, 'POST', 'repositories/:id/publish');
  if (staffRole(context) === null || params === null) return null;
  return accepted({
    repositoryId: params.id as string,
    visibility: 'PUBLIC',
    publishedAt: '2026-07-31T00:00:00.000Z',
  });
};

export const STAFF_HANDLERS: readonly LocalReviewHandler[] = [
  programEditHandler,
  staffProgramTeamsHandler,
  staffProgramTeamDetailHandler,
  programApplicationsHandler,
  applicationDetailHandler,
  submissionMatrixHandler,
  reviewContextHandler,
  createProgramHandler,
  updateProgramHandler,
  createMilestoneHandler,
  updateMilestoneHandler,
  deleteMilestoneHandler,
  decideApplicationHandler,
  createReviewHandler,
  publishRepositoryHandler,
];
