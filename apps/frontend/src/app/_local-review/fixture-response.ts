import { dashboardFixture } from '@/features/dashboard/fixtures';
import type {
  ArchiveApplicationMode,
  ArchiveCategory,
} from '@/features/archive/types';
import type { AuthRole } from '@/features/auth/types';
import type { AuditLogPage, AuditLogRecord } from '@/features/audit-log/types';
import type {
  ProgramListItem,
  ProgramListPage,
  StaffDashboardSummary,
} from '@/features/programs/types';
import { apiPath } from '@/lib/api-client';
import type { LocalReviewFixtureId } from './fixture-contract';
import {
  isAuthenticatedFixture,
  json,
  problem,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewHandler,
  type LocalReviewResponsePlan,
} from './handler-kit';
import { ACCOUNT_HANDLERS } from './handlers/account-handlers';
import { ADMIN_HANDLERS } from './handlers/admin-handlers';
import { STAFF_HANDLERS } from './handlers/staff-handlers';
import { STUDENT_HANDLERS } from './handlers/student-handlers';
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
        total: 3,
        submitted: 1,
        approved: 1,
        rejected: 1,
      },
      applicantsPath: '/staff/programs/program-basic-study/applicants',
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
        approved: 0,
        rejected: 0,
      },
      applicantsPath: '/staff/programs/program-capstone/applicants',
    },
  ],
} as const satisfies StaffDashboardSummary;

const AUDIT_LOG_ACTIONS = [
  'STAFF_ROLE_REQUEST_APPROVED',
  'STAFF_ROLE_REQUEST_REJECTED',
  'STAFF_ROLE_REQUEST_REVOKED',
] as const;

// 감사 로그 기본 limit은 20이다. 로컬 리뷰에서 페이지 이동을 실제로 눌러 볼 수
// 있도록 한 페이지를 넘기는 건수를 둔다 — 20건 이하면 이전·다음이 항상 비활성이라
// 페이지네이션을 검토할 수 없다.
const AUDIT_LOG_FIXTURE_COUNT = 23;

const AUDIT_LOG_FIXTURES: readonly AuditLogRecord[] = Array.from(
  { length: AUDIT_LOG_FIXTURE_COUNT },
  (_, index) => ({
    id: `fixture:audit:${index + 1}`,
    actor: index % 4 === 0 ? 'synthetic-admin' : 'synthetic-reviewer',
    action: AUDIT_LOG_ACTIONS[index % AUDIT_LOG_ACTIONS.length],
    targetType: 'ROLE_REQUEST',
    targetId: `fixture:role-request:${index + 1}`,
    // schemaVersion 2 행의 사람이 읽는 대상 라벨 — 대상의 GitHub 로그인이다.
    target: `synthetic-target-${index + 1}`,
    // 최신순 — 백엔드의 occurredAt desc 정렬과 같은 순서로 둔다.
    occurredAt: `2026-07-${String(AUDIT_LOG_FIXTURE_COUNT - index).padStart(2, '0')}T01:00:00.000Z`,
  }),
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
    description: '신청 전 상태를 확인하기 위한 합성 프로그램입니다.',
  },
] as const satisfies readonly ProgramListItem[];

type PublicArchiveApiItem = {
  readonly repositoryId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: ArchiveCategory;
  readonly applicationMode: ArchiveApplicationMode;
  readonly displayName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
};

type PublicArchiveFixture = {
  readonly item: PublicArchiveApiItem;
  readonly repositoryName: string;
  readonly approvedSubmissionCount: number;
  readonly contributors: readonly {
    readonly userId: string;
    readonly githubNickname: string;
    readonly avatarUrl: string | null;
  }[];
};

const PUBLIC_ARCHIVE_FIXTURES = [
  {
    item: {
      repositoryId: 'synthetic-repo-capstone',
      programId: 'program-capstone',
      programName: '합성 캡스톤 2026',
      category: 'CAPSTONE',
      applicationMode: 'TEAM',
      displayName: '합성 캡스톤 팀 저장소',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-capstone-archive',
      publishedAt: '2026-06-20T00:00:00.000Z',
      detailUrl: '/archive/synthetic-repo-capstone',
    },
    repositoryName: 'synthetic-capstone-archive',
    approvedSubmissionCount: 3,
    contributors: [
      {
        userId: 'synthetic-user-01',
        githubNickname: 'synthetic-contributor-01',
        avatarUrl: null,
      },
      {
        userId: 'synthetic-user-02',
        githubNickname: 'synthetic-contributor-02',
        avatarUrl: null,
      },
    ],
  },
  {
    item: {
      repositoryId: 'synthetic-repo-contest',
      programId: 'program-oss-contest',
      programName: '합성 OSS 경진대회',
      category: 'OSS_CONTEST',
      applicationMode: 'TEAM',
      displayName: '합성 경진대회 팀 저장소',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-contest-archive',
      publishedAt: '2026-05-12T00:00:00.000Z',
      detailUrl: '/archive/synthetic-repo-contest',
    },
    repositoryName: 'synthetic-contest-archive',
    approvedSubmissionCount: 2,
    contributors: [
      {
        userId: 'synthetic-user-03',
        githubNickname: 'synthetic-contributor-03',
        avatarUrl: null,
      },
    ],
  },
  {
    item: {
      repositoryId: 'synthetic-repo-basic',
      programId: 'program-basic-study',
      programName: '합성 기초 오픈소스 스터디',
      category: 'BASIC',
      applicationMode: 'PERSONAL',
      displayName: '합성 개인 실습 저장소',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-basic-archive',
      publishedAt: '2026-04-02T00:00:00.000Z',
      detailUrl: '/archive/synthetic-repo-basic',
    },
    repositoryName: 'synthetic-basic-archive',
    approvedSubmissionCount: 1,
    contributors: [
      {
        userId: 'synthetic-user-04',
        githubNickname: 'synthetic-contributor-04',
        avatarUrl: null,
      },
    ],
  },
] as const satisfies readonly PublicArchiveFixture[];

function authenticatedSession(role: AuthRole | null): LocalReviewResponsePlan {
  const roleLabel = role?.toLowerCase() ?? 'unassigned';
  return json(200, {
    isAuthenticated: true,
    user: {
      nickname: `synthetic-${roleLabel}`,
      name: `합성 ${roleLabel} 사용자`,
      email: null,
      avatarUrl: null,
      role,
    },
  });
}

/**
 * `error-once`에 남은 실패 횟수. "첫 조회는 실패하고 재시도는 성공한다"는 요청
 * **사이에** 기억이 남아야 만들어지므로 모듈 스코프에 둔다.
 *
 * 전역 가변 상태를 두어도 되는 이유: 이 어댑터는 development + 로컬호스트 + 명시
 * 플래그가 모두 맞을 때만 살아 있고(`isLocalReviewRuntime`), 검토자 한 명의
 * 브라우저 하나만 바라본다. 값이 이상하게 굳어도 개발 서버를 다시 띄우면 초기값
 * (실패 1회 남음)으로 돌아간다. 배포 경로에는 이 코드가 도달하지 않는다.
 */
let errorOnceFailuresLeft = 1;

/**
 * 직전 요청의 페르소나. 다른 페르소나를 거쳐 `error-once`로 돌아오면 실패 예산을
 * 다시 채우기 위해 기억한다 — 한 번 쓰고 끝내면 서버를 재시작하기 전에는 오류
 * 화면을 다시 볼 수 없어, 다음 검토자가 같은 흐름을 확인할 방법이 없다.
 */
let lastRequestedFixture: LocalReviewFixtureId | null = null;

function rearmErrorOnceOnFixtureChange(fixture: LocalReviewFixtureId): void {
  if (fixture === lastRequestedFixture) return;
  lastRequestedFixture = fixture;
  errorOnceFailuresLeft = 1;
}

/** 실패 예산이 남았으면 한 번 쓰고 `true`. 그 다음 조회부터는 성공해야 한다. */
function consumeErrorOnceFailure(): boolean {
  if (errorOnceFailuresLeft <= 0) return false;
  errorOnceFailuresLeft -= 1;
  return true;
}

/** 테스트 전용 — 모듈 수준 상태를 초기화한다. */
export function resetLocalReviewFixtureState(): void {
  errorOnceFailuresLeft = 1;
  lastRequestedFixture = null;
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
    case 'unassigned':
    // 역할 승인 대기도 아직 역할이 없는 상태다. 차이는 role-requests/me 응답뿐이다.
    case 'role-pending':
      return authenticatedSession(null);
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

function auditLogPage(searchParams: URLSearchParams): AuditLogPage {
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

function positiveIntParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function recruitmentState(
  program: ProgramListItem,
  now: Date,
): 'scheduled' | 'recruiting' | 'closed' {
  const nowTime = now.getTime();
  if (nowTime < new Date(program.applicationStartAt).getTime()) {
    return 'scheduled';
  }
  return nowTime <= new Date(program.applicationEndAt).getTime()
    ? 'recruiting'
    : 'closed';
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
      (status === 'all' || recruitmentState(program, now) === status),
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
  const matched = PUBLIC_ARCHIVE_FIXTURES.map((fixture) => fixture.item).filter(
    (item) =>
      (query === '' ||
        item.displayName.toLocaleLowerCase('ko').includes(query) ||
        item.programName.toLocaleLowerCase('ko').includes(query)) &&
      (mode === null || item.applicationMode === mode),
  );
  const offset = (page - 1) * pageSize;

  return {
    items: matched.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: matched.length,
  };
}

function publicArchiveDetail(repositoryId: string): unknown | null {
  const fixture = PUBLIC_ARCHIVE_FIXTURES.find(
    (candidate) => candidate.item.repositoryId === repositoryId,
  );
  if (fixture === undefined) return null;
  return {
    ...fixture.item,
    repositoryName: fixture.repositoryName,
    approvedSubmissionCount: fixture.approvedSubmissionCount,
    contributors: fixture.contributors,
  };
}

/** `repositories/{id}/public`에서 id만 뽑는다. 형식이 다르면 이 경로가 아니다. */
function publicRepositoryId(path: string): string | null {
  const matched = /^repositories\/([A-Za-z0-9_-]+)\/public$/.exec(path);
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

  if (method === 'GET' && path === 'repositories/public') {
    return json(200, publicArchivePage(searchParams));
  }

  const repositoryId = method === 'GET' ? publicRepositoryId(path) : null;
  if (repositoryId !== null) {
    const detail = publicArchiveDetail(repositoryId);
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

  // `role-requests` 목록 응답은 여기 있었지만 그 화면이 관리자 접근으로
  // 합쳐지며 사라졌다. 남은 것은 감사 로그다.
  if (method === 'GET' && path === 'audit-logs' && fixture === 'admin') {
    return json(200, auditLogPage(searchParams));
  }

  if (method === 'GET' && path === 'users/me/profile') {
    return json(200, {
      name: '합성 설정 사용자',
      studentId: '260001',
      department: '인공지능학부',
      isComplete: true,
    });
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
