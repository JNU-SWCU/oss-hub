import { dashboardFixture } from '@/features/dashboard/fixtures';
import type {
  ArchiveApplicationMode,
  ArchiveCategory,
} from '@/features/archive/types';
import type { AuthRole } from '@/features/auth/types';
import {
  AUDIT_LOG_ACCESS_RECORD_FIXTURE,
  AUDIT_LOG_LEGACY_RECORD_FIXTURE,
  AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE,
} from '@/features/audit-log/fixtures';
import type { AuditLogPage, AuditLogRecord } from '@/features/audit-log/types';
import type {
  ProgramListItem,
  ProgramListPage,
  ProgramListStatus,
  ProgramStatusCounts,
  StaffDashboardSummary,
} from '@/features/programs/types';
import { staffInsightsWireFixture } from '@/features/staff-insights/fixtures';
import { RANKING_YEAR_ALL } from '@/features/ranking/types';
import type { RankingItem, RankingYear } from '@/features/ranking/types';
import { apiPath } from '@/lib/api-client';
import type { LocalReviewFixtureId } from './fixture-contract';
import {
  isAuthenticatedFixture,
  json,
  localReviewSessionState,
  positiveIntParam,
  problem,
  resetLocalReviewSessionState,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewHandler,
  type LocalReviewResponsePlan,
} from './handler-kit';
import {
  ACCOUNT_HANDLERS,
  myProfileFixtureFor,
  reviewAssignedRole,
  reviewSessionProfileComplete,
} from './handlers/account-handlers';
import { ADMIN_HANDLERS } from './handlers/admin-handlers';
import { BOARD_HANDLERS } from './handlers/board-handlers';
import { MILESTONE_DOCUMENT_HANDLERS } from './handlers/milestone-document-handlers';
import { PROGRAM_OVERVIEW_HANDLERS } from './handlers/program-overview-handlers';
import { STAFF_HANDLERS } from './handlers/staff-handlers';
import { STUDENT_HANDLERS } from './handlers/student-handlers';
import { TEAM_INVITATION_HANDLERS } from './handlers/team-invitation-handlers';
import { STUDENT_JOURNEY_RESPONSES } from './student-journey-fixtures';

export type { LocalReviewResponsePlan } from './handler-kit';

type LocalReviewRequest = {
  readonly fixture: LocalReviewFixtureId;
  readonly method: string;
  readonly path: string;
  readonly searchParams: URLSearchParams;
  /** 파싱된 요청 본문. 라우트가 읽지 못했으면 `undefined`(GET·DELETE는 원래 없다). */
  readonly body?: unknown;
};

/**
 * 도메인별 응답 규칙. 앞에서부터 물어보고 먼저 응답하는 핸들러가 이긴다.
 * 새 화면이 막히면 해당 도메인 모듈에만 규칙을 더한다.
 */
const DOMAIN_HANDLERS: readonly LocalReviewHandler[] = [
  ...ACCOUNT_HANDLERS,
  ...STUDENT_HANDLERS,
  ...STAFF_HANDLERS,
  ...ADMIN_HANDLERS,
  ...PROGRAM_OVERVIEW_HANDLERS,
  ...MILESTONE_DOCUMENT_HANDLERS,
  ...BOARD_HANDLERS,
  ...TEAM_INVITATION_HANDLERS,
];

/**
 * 교직원 대시보드 요약. 프로그램 id는 공개 목록(PUBLIC_PROGRAM_FIXTURES)·학생
 * 동선 픽스처와 **같은 값**이어야 한다. 예전에는 `program:basic` 처럼 다른 체계를
 * 써서, 대시보드 링크를 타고 들어간 화면이 어떤 픽스처와도 매칭되지 않았다.
 */
const STAFF_DASHBOARD_FIXTURE = {
  programs: [
    {
      id: 'program-basic-study',
      name: '합성 기초 오픈소스 스터디',
      category: 'BASIC',
      applicationPeriod: {
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-15T23:59:59.000Z',
      },
      applications: {
        total: 4,
        submitted: 1,
        // 승인 대기는 제출됐지만 아직 판정이 안 난 건수다. 합계·제출·승인·반려와
        // 앞뒤가 맞아야 교직원 대시보드의 요약 숫자가 서로 어긋나지 않는다.
        pendingApproval: 1,
        approved: 2,
        rejected: 1,
      },
      applicantsPath: '/programs/program-basic-study/applicants',
      // 교직원 대시보드가 신청 현황만이 아니라 활동·제출 요약까지 한 화면에서
      // 보여주게 바뀌었다. 셋이 서로 앞뒤가 맞아야 검토자가 화면의 숫자를
      // 의심하지 않는다 — 승인 2건이 곧 제출 대상 2명이다.
      activity: {
        repositories: 2,
        commits: 24,
        pullRequests: 5,
        releases: 1,
        lastActivityAt: '2026-07-30T09:00:00.000Z',
        dataAsOf: '2026-07-31T00:00:00.000Z',
      },
      // 칸별 건수는 제출 현황 표(`staff-program-fixtures.ts`의 BASIC_MATRIX_ROWS)를
      // 그대로 센 값이다 — 카드에서 바로 넘어오는 화면이라 어긋나면 검토 노이즈가 된다.
      submissions: {
        approvedApplications: 2,
        milestones: 2,
        total: 4,
        notSubmitted: 0,
        submitted: 1,
        approved: 3,
        changesRequested: 0,
        rejected: 0,
      },
    },
    {
      id: 'program-capstone',
      name: '합성 캡스톤 2026',
      category: 'CAPSTONE',
      applicationPeriod: {
        startsAt: '2026-08-16T00:00:00.000Z',
        endsAt: '2026-08-31T23:59:59.000Z',
      },
      applications: {
        total: 0,
        submitted: 0,
        pendingApproval: 0,
        approved: 0,
        rejected: 0,
      },
      applicantsPath: '/programs/program-capstone/applicants',
      // 아직 아무도 신청하지 않은 프로그램. 빈 상태가 어떻게 보이는지도
      // 검토 대상이라 0으로 채운 요약을 함께 둔다.
      activity: {
        repositories: 0,
        commits: 0,
        pullRequests: 0,
        releases: 0,
        lastActivityAt: null,
        dataAsOf: '2026-07-31T00:00:00.000Z',
      },
      // 마일스톤은 승인된 신청이 없어도 프로그램에 있는 만큼 센다(backend
      // `submission-dashboard-summary.service.ts`). 제출 칸은 승인 0건이라 0이다.
      submissions: {
        approvedApplications: 0,
        milestones: 3,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    },
  ],
} as const satisfies StaffDashboardSummary;

// 화면 DTO(AuditLogRecord)는 라벨 필드만 쓰지만 backend 가 내려주는 wire record 는
// 판별 필드 legacy·metadata 와 핸들 필드까지 11키다. 파서가 exact key 로 검증해
// 하나만 어긋나도 던지므로, fixture 가 화면 DTO 만 흉내 내면 HTTP 는 200인데
// 화면은 "감사 로그를 불러오지 못했습니다"·총 0건으로 죽는다. 그래서 wire 계약
// 쪽을 미러링한다.
type AuditLogWireRecord = AuditLogRecord & {
  readonly legacy: boolean;
  readonly metadata: Record<string, unknown> | null;
};

type AuditLogWirePage = Omit<AuditLogPage, 'items'> & {
  readonly items: readonly AuditLogWireRecord[];
};

/**
 * 감사 로그 fixture. 레코드 모양·metadata 스키마는 화면과 같은 canonical
 * fixture(`features/audit-log/fixtures.ts`)를 seed 로 그대로 쓴다. 여기서 다시
 * 만들면 계약 소유자가 둘이 되어, 파서 키 검사는 통과해도 metadata 의미가
 * 바뀔 때 fixture 내용만 조용히 어긋난다.
 *
 * 로컬 검토가 canonical 에서 더 필요로 하는 것은 "여러 페이지"뿐이라,
 * 이 파일은 id·시각·대상 식별자만 변형해 건수를 늘린다.
 */
const AUDIT_LOG_SEEDS = [
  AUDIT_LOG_ACCESS_RECORD_FIXTURE,
  AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE,
  AUDIT_LOG_LEGACY_RECORD_FIXTURE,
] as const satisfies readonly AuditLogWireRecord[];

// 기본 limit 은 20이다. 한 페이지를 넘겨야 이전·다음 버튼이 살아나므로, 페이지
// 이동을 실제로 눌러 보려면 20건보다 많아야 한다.
const AUDIT_LOG_FIXTURE_COUNT = 23;

const AUDIT_LOG_FIXTURES: readonly AuditLogWireRecord[] = Array.from(
  { length: AUDIT_LOG_FIXTURE_COUNT },
  (_, index) => {
    const seed = AUDIT_LOG_SEEDS[index % AUDIT_LOG_SEEDS.length];
    const suffix = index + 1;
    const targetId = `${seed.targetId}-${suffix}`;
    return {
      ...seed,
      id: `${seed.id}-${suffix}`,
      targetId,
      // legacy 행의 대상 라벨은 `targetType / targetId` 폴백이라 id 를 바꾸면
      // 라벨도 같이 따라가야 한다. schemaVersion 2 행의 라벨은 대상의 GitHub
      // 로그인이라 seed 값을 그대로 둔다.
      target: seed.legacy ? `${seed.targetType} / ${targetId}` : seed.target,
      // 최신순 — 백엔드의 occurredAt desc 정렬과 같은 순서로 둔다.
      occurredAt: `2026-07-${String(AUDIT_LOG_FIXTURE_COUNT - index).padStart(2, '0')}T01:00:00.000Z`,
    };
  },
);

/**
 * 공개 셸(랜딩·프로그램 목록·공개 아카이브)이 읽는 목록 응답이다.
 * 로그인 없이 보이는 화면이라 모든 persona가 같은 합성 데이터를 본다.
 * 날짜는 두 파서 모두 `Date#toISOString()` 형식만 통과시키므로 UTC(`Z`)로 적는다.
 */
const PUBLIC_PROGRAM_FIXTURES = [
  {
    id: 'program-capstone',
    name: '합성 캡스톤 2026',
    organizer: '합성 SW중심대학사업단',
    category: 'CAPSTONE',
    applicationStartAt: '2026-06-30T15:00:00.000Z',
    applicationEndAt: '2026-12-31T14:59:59.000Z',
    endAt: null,
    description:
      '로컬 검토용 합성 프로그램입니다. 실제 모집이나 실제 참여자와 무관합니다.',
  },
  {
    id: 'program-oss-contest',
    name: '합성 OSS 경진대회',
    organizer: '합성 SW중심대학사업단',
    category: 'OSS_CONTEST',
    applicationStartAt: '2026-07-14T15:00:00.000Z',
    applicationEndAt: '2026-11-30T14:59:59.000Z',
    endAt: null,
    description:
      '로컬 검토용 합성 경진대회입니다. 화면 구성 확인 외의 의미는 없습니다.',
  },
  {
    id: 'program-basic-study',
    name: '합성 기초 오픈소스 스터디',
    organizer: '합성 SW중심대학사업단',
    category: 'BASIC',
    // 학생 동선에서 이 프로그램이 "신청 전" 상태라, 목록에서 모집이 끝난 것으로
    // 보이면 상세와 어긋난다. 신청 화면을 검토하려면 모집이 열려 있어야 한다.
    applicationStartAt: '2026-06-30T15:00:00.000Z',
    applicationEndAt: '2026-10-31T14:59:59.000Z',
    endAt: null,
    description: '신청 전 상태를 확인하기 위한 합성 프로그램입니다.',
  },
  {
    id: 'program-sw-value',
    name: '합성 SW가치확산 프로그램',
    organizer: '합성 SW중심대학사업단',
    category: 'SW_VALUE_SPREAD',
    // 학생 동선에서 이 프로그램은 "반려됨" 상태다 — 판정이 끝난 뒤라 모집도 닫혀
    // 있어야 목록과 상세가 어긋나 보이지 않는다
    // (`handlers/student-program-fixtures.ts`의 `SW_VALUE_BASE`와 같은 기간).
    applicationStartAt: '2025-12-31T15:00:00.000Z',
    applicationEndAt: '2026-06-30T14:59:59.000Z',
    endAt: null,
    description: '반려된 신청 상태를 확인하기 위한 합성 프로그램입니다.',
  },
] as const satisfies readonly ProgramListItem[];

type PublicArchiveApiItem = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: ArchiveCategory;
  readonly applicationMode: ArchiveApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
};

/**
 * 공개 아카이브 응답. 파서가 키를 정확히 일치로 검사하므로(hasExactKeys)
 * detailUrl·page·total 처럼 화면이 파생시키는 값은 응답에 넣지 않는다.
 */
type PublicArchiveFixture = {
  readonly item: PublicArchiveApiItem;
  readonly metrics: {
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  };
  readonly contributors: readonly {
    readonly githubLogin: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
};

const PUBLIC_ARCHIVE_FIXTURES = [
  {
    item: {
      projectId: 'synthetic-repo-capstone',
      programId: 'program-capstone',
      programName: '합성 캡스톤 2026',
      category: 'CAPSTONE',
      applicationMode: 'TEAM',
      displayName: '합성 캡스톤 팀 저장소',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-capstone-archive',
      repositoryName: 'synthetic-capstone-archive',
      publishedAt: '2026-06-20T00:00:00.000Z',
    },
    metrics: { commitCount: 21, pullRequestCount: 3, releaseCount: 1 },
    contributors: [
      {
        githubLogin: 'synthetic-contributor-01',
        commitCount: 9,
        pullRequestCount: 2,
        releaseCount: 1,
      },
      {
        githubLogin: 'synthetic-contributor-02',
        commitCount: 9,
        pullRequestCount: 2,
        releaseCount: 1,
      },
    ],
  },
  {
    item: {
      projectId: 'synthetic-repo-contest',
      programId: 'program-oss-contest',
      programName: '합성 OSS 경진대회',
      category: 'OSS_CONTEST',
      applicationMode: 'TEAM',
      displayName: '합성 경진대회 팀 저장소',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-contest-archive',
      repositoryName: 'synthetic-contest-archive',
      publishedAt: '2026-05-12T00:00:00.000Z',
    },
    metrics: { commitCount: 14, pullRequestCount: 2, releaseCount: 1 },
    contributors: [
      {
        githubLogin: 'synthetic-contributor-03',
        commitCount: 9,
        pullRequestCount: 2,
        releaseCount: 1,
      },
    ],
  },
  {
    item: {
      projectId: 'synthetic-repo-basic',
      programId: 'program-basic-study',
      programName: '합성 기초 오픈소스 스터디',
      category: 'BASIC',
      applicationMode: 'PERSONAL',
      displayName: '합성 개인 실습 저장소',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-basic-archive',
      repositoryName: 'synthetic-basic-archive',
      publishedAt: '2026-04-02T00:00:00.000Z',
    },
    metrics: { commitCount: 7, pullRequestCount: 1, releaseCount: 1 },
    contributors: [
      {
        githubLogin: 'synthetic-contributor-04',
        commitCount: 9,
        pullRequestCount: 2,
        releaseCount: 1,
      },
    ],
  },
] as const satisfies readonly PublicArchiveFixture[];

/**
 * 역할이 배정된 페르소나는 프로필까지 마친 상태로 본다.
 *
 * 온보딩 순서가 역할 → 프로필이라 `RoleGate`가 "역할은 있는데 프로필이 비어 있는"
 * 사용자를 프로필 단계로 되돌린다. 여기서 이 값을 빼면 학생·교직원·관리자 페르소나가
 * 모두 업무 화면 대신 프로필 입력으로 튕겨 나가 아무 화면도 검토할 수 없다.
 * 역할이 없는 페르소나(`unassigned`)에게는 의미가 없다 — 그쪽은 `OnboardingGate`가
 * `users/me/profile`을 직접 조회해 판단한다.
 */
/**
 * 로그인된 세션 응답.
 *
 * `isProfileComplete`는 기본값을 "역할이 있으면 완료"로 둔다 — 고정 페르소나들은
 * 이미 프로필이 채워진 상태로 시작하기 때문이다. 온보딩 중인 페르소나만 이 값을
 * 직접 넘긴다: 역할은 정해졌는데 프로필은 비어 있는 구간이 실제로 존재하고, 그
 * 구간을 완료로 답하면 `RoleGate`가 프로필 단계를 건너뛴다.
 */
function authenticatedSession(
  role: AuthRole | null,
  isProfileComplete: boolean = role !== null,
): LocalReviewResponsePlan {
  const roleLabel = role?.toLowerCase() ?? 'unassigned';
  return json(200, {
    isAuthenticated: true,
    user: {
      nickname: `synthetic-${roleLabel}`,
      name: `합성 ${roleLabel} 사용자`,
      email: null,
      avatarUrl: null,
      role,
      isProfileComplete,
    },
  });
}

/**
 * `error-once`의 실패 예산도 요청 **사이에** 남아야 만들어지는 상태라 검토 세션
 * 상태(`handler-kit`의 `localReviewSessionState`)에 함께 둔다. 여기 모듈 변수로
 * 두면 라우트가 처음 컴파일될 때 예산이 조용히 다시 차, 이미 복구된 세션이 갑자기
 * 다시 실패한다 — 고른 역할이 사라지던 것과 정확히 같은 원인이다.
 *
 * 다른 페르소나를 거쳐 `error-once`로 돌아오면 예산을 다시 채운다. 한 번 쓰고
 * 끝내면 서버를 재시작하기 전에는 오류 화면을 다시 볼 수 없어, 다음 검토자가 같은
 * 흐름을 확인할 방법이 없다.
 */
function rearmErrorOnceOnFixtureChange(fixture: LocalReviewFixtureId): void {
  const state = localReviewSessionState();
  if (fixture === state.lastRequestedFixture) return;
  state.lastRequestedFixture = fixture;
  state.errorOnceFailuresLeft = 1;
}

/** 실패 예산이 남았으면 한 번 쓰고 `true`. 그 다음 조회부터는 성공해야 한다. */
function consumeErrorOnceFailure(): boolean {
  const state = localReviewSessionState();
  if (state.errorOnceFailuresLeft <= 0) return false;
  state.errorOnceFailuresLeft -= 1;
  return true;
}

/** 테스트 전용 — 검토 세션 상태를 통째로 초기화한다. */
export function resetLocalReviewFixtureState(): void {
  resetLocalReviewSessionState();
}

function sessionResponse(
  fixture: LocalReviewFixtureId,
): LocalReviewResponsePlan {
  switch (fixture) {
    case 'anonymous':
      return json(200, { isAuthenticated: false });
    case 'student':
    case 'settings':
    case 'wrong-role':
      return authenticatedSession('STUDENT');
    case 'staff':
      return authenticatedSession('STAFF');
    case 'admin':
      return authenticatedSession('ADMIN');
    // 온보딩 중인 페르소나. 학생으로 **가입을 마치면** 그 자리에서 역할이 확정되므로
    // (백엔드는 프로필 완료 저장에서 배정한다 — `users.repository.ts`) 세션도 함께
    // 바뀌어야 한다. 계속 미배정으로 답하면 게이트가 역할 선택 화면으로 되돌려
    // 검토자는 "제출은 되는데 화면이 그대로"인 상태에 갇힌다.
    //
    // 완료 여부는 실물과 같이 **배정된 역할 기준**으로 계산한다
    // (`handlers/account-handlers.ts`의 `reviewSessionProfileComplete`).
    case 'unassigned':
      return authenticatedSession(
        reviewAssignedRole(),
        reviewSessionProfileComplete(),
      );
    // 역할 승인 대기는 승인 전까지 역할이 없는 것이 정상이다. 프로필은 이미 채운
    // 상태라 차이는 role-requests/me 응답뿐이다. 반려도 같다 — 세션은 구별되지
    // 않고 역할 요청 응답만 다르므로(`handlers/account-handlers.ts`) 여기서 갈리지
    // 않는다.
    case 'role-pending':
    case 'role-rejected':
      return authenticatedSession(null, true);
    case 'loading':
      return { kind: 'delay', milliseconds: 60_000 };
    case 'error':
      return problem(503, 'LFX_503', apiPath('auth/session'));
    // `error`가 "계속 죽어 있는 백엔드"라면 이쪽은 "한 번 흔들리고 돌아오는
    // 백엔드"다. 실패는 세션 조회에만 준다 — 공개 목록까지 함께 실패시키면 무엇을
    // 복구한 것인지 흐려지고, 화면이 세션 실패와 데이터 실패를 구분해 다루는지도
    // 볼 수 없다.
    case 'error-once':
      return consumeErrorOnceFailure()
        ? problem(503, 'LFX_503', apiPath('auth/session'))
        : authenticatedSession('STUDENT');
    default: {
      const exhaustive: never = fixture;
      return exhaustive;
    }
  }
}

function auditLogPage(searchParams: URLSearchParams): AuditLogWirePage {
  const actor = (searchParams.get('actor') ?? '').trim().toLowerCase();
  const action = searchParams.get('action') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const matched = AUDIT_LOG_FIXTURES.filter((record) => {
    const day = record.occurredAt.slice(0, 10);
    return (
      (actor === '' || record.actor.toLowerCase().includes(actor)) &&
      (action === '' || record.action === action) &&
      (from === '' || day >= from) &&
      (to === '' || day <= to)
    );
  });
  const page = Number(searchParams.get('page') ?? '1');
  const limit = Number(searchParams.get('limit') ?? '20');
  return {
    items: matched.slice((page - 1) * limit, page * limit),
    total: matched.length,
    page,
    limit,
  };
}

/**
 * 공개 목록 기간 필터 — backend `program-list-status-filter.ts`의
 * `deriveProgramListStatus`를 그대로 옮긴 것이다. 배타 우선순위(첫 매치 승)까지 같다.
 *
 * ⚠ 이전 구현은 `scheduled`·`closed`라는 **API에 없는 어휘**를 썼다. 화면이 보내는
 * `?status=upcoming|in_progress|ended`가 어느 것과도 같지 않아 로컬 검토에서만
 * 결과가 0건이 됐다(실제 backend는 정상 응답한다). 뱃지(`programs/status-counts`)와
 * 목록이 같은 판정을 쓰지 않으면 숫자가 어긋나 "화면은 멀쩡한데 답이 틀리는"
 * 상태가 되므로 둘 다 이 함수를 쓴다.
 */
function programListStatus(
  program: ProgramListItem,
  now: Date,
): Exclude<ProgramListStatus, 'all'> {
  if (program.lifecycle === 'ARCHIVED') return 'ended';
  const nowTime = now.getTime();
  if (program.endAt !== null && new Date(program.endAt).getTime() < nowTime) {
    return 'ended';
  }
  if (new Date(program.applicationStartAt).getTime() > nowTime) {
    return 'upcoming';
  }
  return new Date(program.applicationEndAt).getTime() >= nowTime
    ? 'recruiting'
    : 'in_progress';
}

/**
 * 공개 랭킹. 실명·실제 계정을 남기지 않도록 합성 핸들만 쓴다
 * (`docs/rules/security.md` public-safe 규칙).
 *
 * 파서는 관용적 읽기(tolerant reader)라 모르는 키를 무시하지만, **화면이 쓰는
 * 키는 wire 이름 그대로** 내려야 한다 — 지표는 commit·PR·issue·repo·star 5종이며
 * 한 칸이라도 이름이 어긋나면 HTTP 는 200인데 그 열만 조용히 0이 된다.
 * `starCount`는 계정 전체 누적이라 연도별로 더하지 않는다(아래 `all` 병합 참고).
 */
const RANKING_YEARS = [2026, 2025] as const;

/**
 * ⚠ 연도마다 **다른** 사람·다른 숫자를 준다. 모든 연도에 같은 행을 돌려주면
 * 연도 전환이 화면에서 아무것도 바꾸지 않아, 검토자가 연도 필터가 도는지
 * 확인할 방법이 없다 — 픽스처가 계약보다 너그러운 바로 그 상태다.
 * backend `RankingService`는 실제로 연도로 집계를 좁힌다.
 */
/**
 * `displayName` 은 여기 담지 않는다 — 그 칸은 **계층이 정하는 값**이라
 * (`rankingWireItem`) 픽스처가 미리 적어 두면 비로그인 응답에 실명이 섞이는
 * 모양을 만들어 낸다. 실명은 `realName` 으로 따로 들고, 학과는 공개 정보라
 * 계층과 무관하게 그대로 나간다(owner 결정 2026-08-19).
 */
type RankingActivity = Omit<RankingItem, 'rank' | 'total' | 'displayName'> & {
  /** 교직원·관리자 응답에서만 `displayName` 으로 나가는 실명. 없는 사람도 있다. */
  readonly realName: string | null;
};

const RANKING_ACTIVITY_BY_YEAR: Readonly<
  Record<number, readonly RankingActivity[]>
> = {
  2026: [
    {
      githubLogin: 'synthetic-top',
      realName: 'synthetic-name-top',
      department: '소프트웨어공학과',
      commitCount: 128,
      pullRequestCount: 24,
      issueCount: 17,
      repositoryCount: 9,
      starCount: 213,
    },
    {
      githubLogin: 'synthetic-second',
      realName: 'synthetic-name-second',
      department: '인공지능학부',
      commitCount: 96,
      pullRequestCount: 18,
      issueCount: 11,
      repositoryCount: 6,
      starCount: 48,
    },
    // 활동이 아직 0인 가입자. 사람 축 랭킹은 이런 사람을 목록에서 빼지 않는다 —
    // 빼버리면 신입이 화면에서 사라져 "가입은 됐는데 어디에도 없는" 상태가 된다.
    // 학과가 비어 있는 사람이기도 하다 — 화면이 그 칸을 대시로 채우는지 보이는 행이다.
    {
      githubLogin: 'synthetic-newcomer',
      realName: null,
      department: null,
      commitCount: 0,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
    },
  ],
  2025: [
    {
      githubLogin: 'synthetic-veteran',
      realName: 'synthetic-name-veteran',
      department: '컴퓨터정보통신공학과',
      commitCount: 64,
      pullRequestCount: 11,
      issueCount: 8,
      repositoryCount: 5,
      starCount: 91,
    },
    {
      githubLogin: 'synthetic-top',
      realName: 'synthetic-name-top',
      department: '소프트웨어공학과',
      commitCount: 41,
      pullRequestCount: 7,
      issueCount: 3,
      repositoryCount: 2,
      starCount: 213,
    },
  ],
};

/** 순위가 매겨진 행. 계층별 `displayName` 은 아직 정해지지 않았다. */
type RankedActivity = RankingActivity & {
  readonly rank: number;
  readonly total: number;
};

/** total 과 rank 는 저장하지 않고 계산한다 — 손으로 적으면 서로 어긋난다. */
function rankedItems(
  activities: readonly RankingActivity[],
): readonly RankedActivity[] {
  return activities
    .map((activity) => ({
      ...activity,
      total:
        activity.commitCount +
        activity.pullRequestCount +
        activity.issueCount +
        activity.repositoryCount +
        activity.starCount,
    }))
    .sort((left, right) => right.total - left.total)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/** `all` 은 연도별 활동을 사람 단위로 합친다 — 같은 사람이 두 해에 걸쳐 있다. */
function rankingItemsFor(year: RankingYear): readonly RankedActivity[] {
  if (year !== RANKING_YEAR_ALL) {
    return rankedItems(RANKING_ACTIVITY_BY_YEAR[year] ?? []);
  }
  const merged = new Map<string, RankingActivity>();
  for (const activities of Object.values(RANKING_ACTIVITY_BY_YEAR)) {
    for (const activity of activities) {
      const previous = merged.get(activity.githubLogin);
      merged.set(
        activity.githubLogin,
        previous === undefined
          ? activity
          : {
              ...previous,
              commitCount: previous.commitCount + activity.commitCount,
              pullRequestCount:
                previous.pullRequestCount + activity.pullRequestCount,
              issueCount: previous.issueCount + activity.issueCount,
              repositoryCount:
                previous.repositoryCount + activity.repositoryCount,
              // star 는 누적치라 연도별로 더하면 같은 별을 두 번 센다.
              starCount: Math.max(previous.starCount, activity.starCount),
            },
      );
    }
  }
  return rankedItems([...merged.values()]);
}

/**
 * Matches backend RankingEntryResponseDto. displayName is always githubLogin.
 * Staff envelopes add `name`; public items omit that key.
 */
function rankingWireItem(item: RankedActivity, role: AuthRole | null): unknown {
  const staff = role === 'STAFF' || role === 'ADMIN';
  return {
    rank: item.rank,
    displayName: item.githubLogin,
    githubLogin: item.githubLogin,
    ...(staff ? { name: item.realName } : {}),
    department: item.department,
    commitCount: item.commitCount,
    pullRequestCount: item.pullRequestCount,
    issueCount: item.issueCount,
    repositoryCount: item.repositoryCount,
    starCount: item.starCount,
    total: item.total,
  };
}

function rankingPage(
  searchParams: URLSearchParams,
  role: AuthRole | null,
): unknown {
  const page = positiveIntParam(searchParams.get('page'), 1);
  const pageSize = positiveIntParam(searchParams.get('pageSize'), 20);
  const rawYear = searchParams.get('year');
  // `?year=`는 연도 아니면 `all`이다. 파서가 그 둘만 통과시키므로 픽스처도 같게 좁힌다.
  const parsedYear = Number(rawYear);
  const year: RankingYear =
    rawYear !== null && Number.isInteger(parsedYear) && parsedYear >= 2000
      ? parsedYear
      : RANKING_YEAR_ALL;
  const items = rankingItemsFor(year);
  const offset = (page - 1) * pageSize;

  return {
    year,
    items: items
      .slice(offset, offset + pageSize)
      .map((item) => rankingWireItem(item, role)),
    page,
    pageSize,
    total: items.length,
    // 수집이 한 번 돌아간 상태를 흔낸다. `null`로 두면 화면이 항상 "아직 수집 전"
    // 안내만 띄워 검토자가 정상 랭킹 화면을 볼 수 없다 — 그 대기 상태는
    // `ranking-view.test.tsx`가 고정한다.
    dataAsOf: '2026-08-19T02:30:00.000Z',
    viewerClass: role === 'STAFF' || role === 'ADMIN' ? 'staff' : 'public',
    nextCycleAt: '2026-08-21T00:00:00.000Z',
  };
}

/** 사이드바 뱃지. 5키가 항상 있고 `all === 나머지 넷의 합`이다. */
function programStatusCounts(now: Date): ProgramStatusCounts {
  const counts: Record<ProgramListStatus, number> = {
    all: PUBLIC_PROGRAM_FIXTURES.length,
    recruiting: 0,
    in_progress: 0,
    upcoming: 0,
    ended: 0,
  };
  for (const program of PUBLIC_PROGRAM_FIXTURES) {
    counts[programListStatus(program, now)] += 1;
  }
  return counts;
}

/** `/programs`(status=all)와 랜딩(status=recruiting)이 같은 경로를 쓰므로 질의를 그대로 반영한다 */
function programListPage(searchParams: URLSearchParams): ProgramListPage {
  const now = new Date();
  const page = positiveIntParam(searchParams.get('page'), 1);
  const pageSize = positiveIntParam(searchParams.get('pageSize'), 20);
  const search = (searchParams.get('search') ?? '')
    .trim()
    .toLocaleLowerCase('ko');
  const status = searchParams.get('status') ?? 'all';
  const matched = PUBLIC_PROGRAM_FIXTURES.filter(
    (program) =>
      program.name.toLocaleLowerCase('ko').includes(search) &&
      (status === 'all' || programListStatus(program, now) === status),
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

function publicArchivePage(searchParams: URLSearchParams): unknown {
  const page = positiveIntParam(searchParams.get('page'), 1);
  const pageSize = positiveIntParam(searchParams.get('pageSize'), 12);
  const query = (searchParams.get('q') ?? '').trim().toLocaleLowerCase('ko');
  const mode = searchParams.get('applicationMode');
  const category = searchParams.get('category');
  const matched = PUBLIC_ARCHIVE_FIXTURES.map((fixture) => fixture.item).filter(
    (item) =>
      (query === '' ||
        item.displayName.toLocaleLowerCase('ko').includes(query) ||
        item.programName.toLocaleLowerCase('ko').includes(query)) &&
      (mode === null || item.applicationMode === mode) &&
      (category === null || item.category === category),
  );
  const offset = (page - 1) * pageSize;

  const items = matched.slice(offset, offset + pageSize);
  return {
    items,
    pageSize,
    nextPageId:
      offset + items.length < matched.length ? String(page + 1) : null,
  };
}

function publicArchiveCategoryCounts(): unknown {
  const empty = {
    all: 0,
    BASIC: 0,
    SW_VALUE_SPREAD: 0,
    OSS_CONTEST: 0,
    CAPSTONE: 0,
    SW_CONVERGENCE: 0,
    GLOBAL_MAKERTHON: 0,
    CORPORATE_INTERNSHIP: 0,
  };
  const counts = { ...empty };
  for (const fixture of PUBLIC_ARCHIVE_FIXTURES) {
    counts[fixture.item.category] += 1;
    counts.all += 1;
  }
  return counts;
}

function publicArchiveDetail(projectId: string): unknown | null {
  const fixture = PUBLIC_ARCHIVE_FIXTURES.find(
    (candidate) => candidate.item.projectId === projectId,
  );
  if (fixture === undefined) return null;
  return {
    ...fixture.item,
    metrics: fixture.metrics,
    contributors: fixture.contributors,
  };
}

/** `projects/{id}`에서 id만 뽑는다. 형식이 다르면 이 경로가 아니다. */
function publicProjectId(path: string): string | null {
  const matched = /^projects\/([A-Za-z0-9_-]+)$/.exec(path);
  return matched?.[1] ?? null;
}

export function resolveLocalReviewResponse({
  fixture,
  method,
  path,
  searchParams,
  body,
}: LocalReviewRequest): LocalReviewResponsePlan {
  rearmErrorOnceOnFixtureChange(fixture);

  // loading·error 페르소나는 "느린 백엔드"와 "죽은 백엔드"를 흉내 내는 것이므로
  // 특정 경로만이 아니라 모든 호출에 같은 결과를 준다. 일부 경로만 성공하면
  // 화면이 절반만 로딩된 이상한 상태가 되어 검토 대상이 흐려진다.
  if (fixture === 'loading') return { kind: 'delay', milliseconds: 60_000 };
  if (fixture === 'error') return problem(503, 'LFX_503', apiPath(path));

  if (method === 'GET' && path === 'auth/session') {
    return sessionResponse(fixture);
  }

  if (method === 'GET' && path === 'programs') {
    return json(200, programListPage(searchParams));
  }

  // ⚠ `programs/:id`보다 **먼저** 와야 한다. 뒤에 두면 `status-counts`가 프로그램
  // id로 먹혀 로컬 검토에서만 404가 난다(QA8). backend 도 같은 이유로
  // `programs.controller.ts`에서 이 라우트를 `:id` 앞에 두고 주석을 달아 뒀다.
  if (method === 'GET' && path === 'programs/status-counts') {
    return json(200, programStatusCounts(new Date()));
  }

  // 랭킹은 비로그인도 보는 공개 화면인데 픽스처에 규칙이 아예 없어 두 요청 모두
  // 404로 떨어졌다(QA9). 페르소나를 가리지 않는다.
  if (method === 'GET' && path === 'ranking') {
    // 같은 URL 이 역할에 따라 다른 칸을 내린다(backend `RankingViewerRepository`).
    return json(200, rankingPage(searchParams, roleForFixture(fixture)));
  }

  if (method === 'GET' && path === 'ranking/years') {
    return json(200, { years: RANKING_YEARS });
  }

  if (method === 'GET' && path === 'projects') {
    return json(200, publicArchivePage(searchParams));
  }

  if (method === 'GET' && path === 'projects/category-counts') {
    return json(200, publicArchiveCategoryCounts());
  }

  const projectId = method === 'GET' ? publicProjectId(path) : null;
  if (projectId !== null) {
    const detail = publicArchiveDetail(projectId);
    // 없는 저장소는 상세 화면이 "찾을 수 없음"으로 갈리도록 백엔드 코드를 맞춘다.
    return detail === null
      ? problem(404, 'SHW_001', apiPath(path))
      : json(200, detail);
  }

  if (
    method === 'GET' &&
    path === 'dashboard/student' &&
    (fixture === 'student' ||
      fixture === 'settings' ||
      fixture === 'wrong-role' ||
      // 학생으로 가입을 마친 미배정 페르소나가 마지막에 도착하는 화면이기도 하다.
      // 빠지면 프로필 저장 직후 404가 떠서, 가입 동선의 끝이 실패로 보인다.
      fixture === 'unassigned' ||
      // 복구 후 착지하는 화면이 학생 대시보드다. 여기서 빠지면 재시도가 성공해도
      // 빈 대시보드가 떠서 복구된 것으로 보이지 않는다.
      fixture === 'error-once')
  ) {
    return json(200, dashboardFixture);
  }

  const studentJourneyBody = STUDENT_JOURNEY_RESPONSES[path];
  if (
    method === 'GET' &&
    fixture === 'student' &&
    studentJourneyBody !== undefined
  ) {
    return json(200, studentJourneyBody);
  }

  if (
    method === 'GET' &&
    path === 'dashboard/staff/summary' &&
    (fixture === 'staff' || fixture === 'admin')
  ) {
    return json(200, STAFF_DASHBOARD_FIXTURE);
  }

  if (
    method === 'GET' &&
    path === 'dashboard/staff/insights' &&
    (fixture === 'staff' || fixture === 'admin')
  ) {
    return json(200, staffInsightsWireFixture());
  }

  // `role-requests` 목록 응답은 여기 있었지만 그 화면이 관리자 접근으로
  // 합쳐지며 사라졌다. 남은 것은 감사 로그다.
  if (method === 'GET' && path === 'audit-logs' && fixture === 'admin') {
    return json(200, auditLogPage(searchParams));
  }

  if (method === 'GET' && path === 'users/me/profile') {
    // 미배정 페르소나는 빈 프로필을 본다 — 가입 동선을 처음부터 걸어 보려면
    // 프로필 입력 화면이 실제로 떠야 한다.
    return json(200, myProfileFixtureFor(fixture));
  }

  if (method === 'GET' && path === 'users/me/notification-email') {
    return json(200, {
      notificationEmail: 'fixture@example.com',
      notifyEnabled: true,
    });
  }

  const context: LocalReviewContext = {
    fixture,
    method,
    path,
    searchParams,
    role: roleForFixture(fixture),
    isAuthenticated: isAuthenticatedFixture(fixture),
    body,
  };
  for (const handler of DOMAIN_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }

  return problem(404, 'LFX_404', apiPath(path));
}
