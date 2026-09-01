import type { AdminAccessFacetCounts } from '@/features/roles/admin-access-api';
import type { AuditLogRecord } from '@/features/audit-log/types';
import type { SystemStatusResponse } from '@/features/system-status/types';
import { apiPath } from '@/lib/api-client';
import {
  json,
  matchGet,
  positiveIntParam,
  problem,
  type LocalReviewContext,
  type LocalReviewHandler,
} from '../handler-kit';
import {
  adminAccessFixtureCreatedAt,
  adminAccessFixtureFacets,
  adminAccessFixtureHistory,
  adminAccessFixtureItems,
  findAdminAccessFixtureDetail,
} from './admin-access-fixtures';

/**
 * 관리자 동선의 로컬 검토 응답.
 * 담당 경로: `audit-logs`, `system-status`, `users/access`,
 * `users/access/requests`, `users/access/facets`, `users/{id}/access`,
 * `users/{id}/access/history`.
 *
 * 사용자 목록(`users`)·역할 변경(`users/{id}/role`)·교직원 요청 판정
 * (`role-requests/{id}`) 응답도 여기 있었지만, 그 화면들이 관리자 접근
 * (`/dashboard/users`) 한 곳으로 합쳐지면서 경로 자체가 사라졌다. 새 화면이 읽는
 * `users/access` 계열은 한동안 비어 있었고, 그동안 로컬 검토에서는 목록도
 * 상세도 열리지 않았다 — 픽스처는 `admin-access-fixtures.ts`에 있다.
 *
 * 관리자 전용 화면이라 `admin` 페르소나에만 응답한다. 나머지는 `null`을 돌려
 * 기본 404로 떨어뜨린다.
 */

function isAdmin(context: LocalReviewContext): boolean {
  return context.role === 'ADMIN';
}

function isStaffOrAdmin(context: LocalReviewContext): boolean {
  return context.role === 'ADMIN' || context.role === 'STAFF';
}

const AUDIT_LOG_FIXTURES = [
  {
    id: 'synthetic-audit-01',
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_APPROVED',
    targetType: 'ROLE_REQUEST',
    targetId: 'fixture:staff-request:approved',
    // schemaVersion 2 행의 사람이 읽는 대상 라벨.
    target: 'fixture:staff-request:approved',
    occurredAt: '2026-07-21T01:00:00.000Z',
  },
  {
    id: 'synthetic-audit-02',
    actor: 'synthetic-admin',
    action: 'USER_ROLE_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic-user-11',
    // schemaVersion 2 행의 사람이 읽는 대상 라벨.
    target: 'synthetic-user-11',
    occurredAt: '2026-07-18T02:10:00.000Z',
  },
  {
    id: 'synthetic-audit-03',
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_REJECTED',
    targetType: 'ROLE_REQUEST',
    targetId: 'synthetic-role-request-03',
    // schemaVersion 2 행의 사람이 읽는 대상 라벨.
    target: 'synthetic-role-request-03',
    occurredAt: '2026-07-12T05:30:00.000Z',
  },
  {
    id: 'synthetic-audit-04',
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_REVOKED',
    targetType: 'ROLE_REQUEST',
    targetId: 'synthetic-role-request-04',
    // schemaVersion 2 행의 사람이 읽는 대상 라벨.
    target: 'synthetic-role-request-04',
    occurredAt: '2026-07-05T07:45:00.000Z',
  },
  {
    id: 'synthetic-audit-05',
    actor: 'synthetic-admin',
    action: 'USER_ACCOUNT_STATUS_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic-user-12',
    // schemaVersion 2 행의 사람이 읽는 대상 라벨.
    target: 'synthetic-user-12',
    occurredAt: '2026-06-28T00:20:00.000Z',
  },
] as const satisfies readonly AuditLogRecord[];

const SYSTEM_STATUS_FIXTURE = {
  collection: {
    health: 'DELAYED',
    dataAsOf: '2026-07-31T00:00:00.000Z',
    trackedRepositoryCount: 12,
    readyStreamCount: 9,
    backfillingStreamCount: 1,
    partialStreamCount: 1,
    retryPendingStreamCount: 1,
    oldestReadyCheckpointAt: '2026-07-30T18:00:00.000Z',
    oldestRetryPendingAt: '2026-07-29T09:00:00.000Z',
    lastCycleStartedAt: '2026-07-31T00:00:00.000Z',
    lastCycleCompletedAt: '2026-07-30T18:00:00.000Z',
    nextCycleAt: '2026-07-31T01:00:00.000Z',
    currentRunStatus: 'PROCESSING',
    safeReason: 'STALE_DATA',
  },
  // 저장소×stream 상세 — 정상 3종, backfill 중, 부분, 재시도 대기(오류 있음)를
  // 하나씩 섞어 「수집 대상 상세」 표의 배지·정렬·문제 열을 로컬 검토에서 눈으로
  // 확인할 수 있게 한다.
  collectionStreams: [
    {
      repositoryName: 'jnu-oss/broken-stream-repo',
      // 프로그램 연결 없음(discovery로만 편입된 경우를 흉내낸다) — 표에서 em-dash로 보인다.
      programName: null,
      streams: [
        {
          streamType: 'COMMIT',
          bucket: 'RETRY_PENDING',
          lastSuccessAt: '2026-07-29T09:00:00.000Z',
          lastErrorCode: 'PROVIDER_RATE_LIMITED',
          lastErrorAt: '2026-07-31T00:05:00.000Z',
        },
        {
          streamType: 'PULL_REQUEST',
          bucket: 'PARTIAL',
          lastSuccessAt: '2026-07-30T20:00:00.000Z',
          lastErrorCode: null,
          lastErrorAt: null,
        },
        {
          streamType: 'RELEASE',
          bucket: 'READY',
          lastSuccessAt: '2026-07-30T18:00:00.000Z',
          lastErrorCode: null,
          lastErrorAt: null,
        },
      ],
    },
    {
      repositoryName: 'jnu-oss/healthy-repo',
      // 프로그램 신청 OWN 경로로 편입된 경우를 흉내낸다 — 표에 이름이 그대로 보인다.
      programName: '오픈소스 입문 프로그램',
      streams: [
        {
          streamType: 'COMMIT',
          bucket: 'READY',
          lastSuccessAt: '2026-07-31T00:00:00.000Z',
          lastErrorCode: null,
          lastErrorAt: null,
        },
        {
          streamType: 'PULL_REQUEST',
          bucket: 'READY',
          lastSuccessAt: '2026-07-31T00:00:00.000Z',
          lastErrorCode: null,
          lastErrorAt: null,
        },
        {
          streamType: 'RELEASE',
          bucket: 'READY',
          lastSuccessAt: '2026-07-30T12:00:00.000Z',
          lastErrorCode: null,
          lastErrorAt: null,
        },
      ],
    },
    {
      repositoryName: 'jnu-oss/new-repo-backfilling',
      // 프로그램 연결 없음 — 조직 저장소 대부분이 이 경우다.
      programName: null,
      streams: [
        {
          streamType: 'COMMIT',
          bucket: 'BACKFILLING',
          lastSuccessAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
        },
        {
          streamType: 'PULL_REQUEST',
          bucket: 'BACKFILLING',
          lastSuccessAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      ],
    },
  ],
  // 최근 수집 활동(2단계) — sweepFinishedAt desc. 완료/예산 중단/실패 포함/신규
  // 0건 케이스를 하나씩 섞어 「최근 수집 활동」 피드의 배지·건수·빈 케이스를
  // 로컬 검토에서 눈으로 확인할 수 있게 한다.
  collectionActivity: [
    {
      sweepFinishedAt: '2026-07-31T00:00:00.000Z',
      cycleStartedAt: '2026-07-30T23:55:00.000Z',
      scope: 'org:jnu-swcu',
      insertedCommitCount: 14,
      insertedPullRequestCount: 4,
      insertedReleaseCount: 0,
      attemptedRepositoryCount: 12,
      processedRepositoryCount: 9,
      failedRepositoryCount: 1,
      cycleCompleted: false,
      stoppedForBudget: false,
    },
    {
      sweepFinishedAt: '2026-07-30T18:00:00.000Z',
      cycleStartedAt: '2026-07-30T17:40:00.000Z',
      scope: 'org:jnu-swcu',
      insertedCommitCount: 22,
      insertedPullRequestCount: 6,
      insertedReleaseCount: 2,
      attemptedRepositoryCount: 12,
      processedRepositoryCount: 12,
      failedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
    },
    {
      sweepFinishedAt: '2026-07-30T12:00:00.000Z',
      cycleStartedAt: '2026-07-30T11:00:00.000Z',
      scope: 'external',
      insertedCommitCount: 3,
      insertedPullRequestCount: 0,
      insertedReleaseCount: 0,
      attemptedRepositoryCount: 20,
      processedRepositoryCount: 7,
      failedRepositoryCount: 0,
      cycleCompleted: false,
      stoppedForBudget: true,
    },
    {
      sweepFinishedAt: '2026-07-30T06:00:00.000Z',
      cycleStartedAt: '2026-07-30T05:45:00.000Z',
      scope: 'org:jnu-swcu',
      insertedCommitCount: 0,
      insertedPullRequestCount: 0,
      insertedReleaseCount: 0,
      attemptedRepositoryCount: 12,
      processedRepositoryCount: 12,
      failedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
    },
  ],
} as const satisfies SystemStatusResponse;

/** 기간 필터는 한국 날짜 선택기의 `YYYY-MM-DD`라 ISO 앞 10자리와 비교한다. */
function withinPeriod(
  occurredAt: string,
  from: string | null,
  to: string | null,
): boolean {
  const day = occurredAt.slice(0, 10);
  return (from === null || day >= from) && (to === null || day <= to);
}

const auditLogsHandler: LocalReviewHandler = (context) => {
  if (!isAdmin(context) || matchGet(context, 'audit-logs') === null) {
    return null;
  }
  const actor = (context.searchParams.get('actor') ?? '')
    .trim()
    .toLocaleLowerCase('ko');
  const action = context.searchParams.get('action');
  const from = context.searchParams.get('from');
  const to = context.searchParams.get('to');
  return json(
    200,
    AUDIT_LOG_FIXTURES.filter(
      (record) =>
        record.actor.toLocaleLowerCase('ko').includes(actor) &&
        (action === null || action === '' || record.action === action) &&
        withinPeriod(record.occurredAt, from, to),
    ),
  );
};

const systemStatusHandler: LocalReviewHandler = (context) => {
  if (!isAdmin(context) || matchGet(context, 'system-status') === null) {
    return null;
  }
  return json(200, SYSTEM_STATUS_FIXTURE);
};

/**
 * 목록 필터·정렬 — `admin-access-list-query.ts`가 직렬화하는 파라미터와 같다.
 *
 * `exclude`는 패싯 계산용이다. backend `listAdminAccessFacets`는 각 축의 개수를
 * **자기 축 필터만 뺀 나머지 조건**으로 센다(`adminAccessWhere(query, 'role')` 등).
 * 그래야 「지금 조건에서 이 값을 고르면 몇 건이 되는지」가 뱃지에 나온다.
 */
type AdminAccessFacetAxis = 'role' | 'accountStatus' | 'pendingRequest';

function filteredAdminAccessItems(
  context: LocalReviewContext,
  exclude?: AdminAccessFacetAxis,
) {
  const query = (context.searchParams.get('query') ?? '')
    .trim()
    .toLocaleLowerCase('ko');
  const role = context.searchParams.get('role');
  const accountStatus = context.searchParams.get('accountStatus');
  const pendingRequest = context.searchParams.get('pendingRequest');

  const matched = adminAccessFixtureItems().filter((item) => {
    if (
      query !== '' &&
      !`${item.name ?? ''} ${item.githubLogin}`
        .toLocaleLowerCase('ko')
        .includes(query)
    ) {
      return false;
    }
    if (exclude !== 'role') {
      // 역할 필터의 `UNASSIGNED`는 "역할이 아직 없음"이라 `null`과 짝지어야 한다.
      if (role === 'UNASSIGNED' && item.role !== null) return false;
      if (role !== null && role !== '' && role !== 'UNASSIGNED') {
        if (item.role !== role) return false;
      }
    }
    if (
      exclude !== 'accountStatus' &&
      accountStatus !== null &&
      accountStatus !== '' &&
      item.accountStatus !== accountStatus
    ) {
      return false;
    }
    if (exclude !== 'pendingRequest') {
      if (pendingRequest === 'PENDING' && item.pendingRequest === null) {
        return false;
      }
      if (pendingRequest === 'NONE' && item.pendingRequest !== null) {
        return false;
      }
    }
    return true;
  });

  const sort = context.searchParams.get('sort') ?? 'name';
  const descending = context.searchParams.get('direction') !== 'asc';
  const sorted = [...matched].sort((left, right) => {
    // 값이 없는 쪽(이름 미등록·로그인 기록 없음)은 방향과 무관하게 뒤로 보낸다.
    // `createdAt`도 화면이 실제로 보내는 정렬 값이다(`AdminAccessSortField`).
    // 여기서 빠뜨리면 정렬을 바꿔도 순서가 그대로라 검토자가 정렬 결함을 못 본다.
    const pick = (item: (typeof matched)[number]) => {
      if (sort === 'lastLoginAt') return item.lastLoginAt;
      if (sort === 'createdAt') return adminAccessFixtureCreatedAt(item.id);
      return item.name ?? null;
    };
    const a = pick(left);
    const b = pick(right);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return descending ? b.localeCompare(a, 'ko') : a.localeCompare(b, 'ko');
  });

  return sorted;
}

/**
 * 축마다 자기 필터만 빼고 센다 — backend `listAdminAccessFacets`와 같은 규칙이다.
 * 전체 데이터로 세면 「비활성만 보기」를 눌러도 승인 대기 뱃지가 그대로 남아,
 * 로컬 검토의 숫자가 운영과 달라진다.
 */
function adminAccessContextFacets(
  context: LocalReviewContext,
): AdminAccessFacetCounts {
  const byRole = adminAccessFixtureFacets(
    filteredAdminAccessItems(context, 'role'),
  );
  const byAccountStatus = adminAccessFixtureFacets(
    filteredAdminAccessItems(context, 'accountStatus'),
  );
  const byPendingRequest = adminAccessFixtureFacets(
    filteredAdminAccessItems(context, 'pendingRequest'),
  );
  return {
    roles: byRole.roles,
    accountStatuses: byAccountStatus.accountStatuses,
    pendingRequests: byPendingRequest.pendingRequests,
  };
}

const adminAccessRequestsHandler: LocalReviewHandler = (context) => {
  if (
    !isStaffOrAdmin(context) ||
    matchGet(context, 'users/access/requests') === null
  ) {
    return null;
  }
  const pendingParams = new URLSearchParams(context.searchParams);
  pendingParams.set('pendingRequest', 'PENDING');
  const items = filteredAdminAccessItems({
    ...context,
    searchParams: pendingParams,
  });
  const page = positiveIntParam(context.searchParams.get('page'), 1);
  const limit = positiveIntParam(context.searchParams.get('limit'), 20);
  const start = (page - 1) * limit;
  return json(200, {
    items: items.slice(start, start + limit),
    page,
    limit,
    total: items.length,
    facets: adminAccessContextFacets({
      ...context,
      searchParams: pendingParams,
    }),
  });
};

const adminAccessListHandler: LocalReviewHandler = (context) => {
  if (!isAdmin(context) || matchGet(context, 'users/access') === null) {
    return null;
  }
  const items = filteredAdminAccessItems(context);
  const page = positiveIntParam(context.searchParams.get('page'), 1);
  const limit = positiveIntParam(context.searchParams.get('limit'), 20);
  const start = (page - 1) * limit;
  return json(200, {
    items: items.slice(start, start + limit),
    page,
    limit,
    total: items.length,
    facets: adminAccessContextFacets(context),
  });
};

const adminAccessFacetsHandler: LocalReviewHandler = (context) => {
  if (!isAdmin(context) || matchGet(context, 'users/access/facets') === null) {
    return null;
  }
  return json(200, adminAccessContextFacets(context));
};

const adminAccessDetailHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'users/:userId/access');
  if (!isStaffOrAdmin(context) || params === null) return null;
  const detail = findAdminAccessFixtureDetail(params.userId as string);
  if (!detail || (context.role === 'STAFF' && detail.pendingRequest === null)) {
    // 상세 화면은 `ROL_010`일 때만 "사용자를 찾을 수 없습니다" 빈 화면을
    // 그린다(admin-access-detail-api.ts의 `isNotFound`). 기본 404 코드를
    // 쓰면 같은 화면이 일반 오류로 보여 검토자가 제품 결함으로 오해한다.
    // STAFF는 대기 요청이 없는 사용자를 없는 사용자와 같은 404로 본다.
    return problem(404, 'ROL_010', apiPath(context.path));
  }
  return json(200, detail);
};

const adminAccessHistoryHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'users/:userId/access/history');
  if (!isStaffOrAdmin(context) || params === null) return null;
  const userId = params.userId as string;
  const detail = findAdminAccessFixtureDetail(userId);
  if (!detail || (context.role === 'STAFF' && detail.pendingRequest === null)) {
    return problem(404, 'ROL_010', apiPath(context.path));
  }
  return json(
    200,
    adminAccessFixtureHistory(userId, {
      staffAccessRequestPage: positiveIntParam(
        context.searchParams.get('staffAccessRequestPage'),
        1,
      ),
      staffAccessRequestLimit: positiveIntParam(
        context.searchParams.get('staffAccessRequestLimit'),
        20,
      ),
      loginPage: positiveIntParam(context.searchParams.get('loginPage'), 1),
      loginLimit: positiveIntParam(context.searchParams.get('loginLimit'), 20),
    }),
  );
};

export const ADMIN_HANDLERS: readonly LocalReviewHandler[] = [
  auditLogsHandler,
  systemStatusHandler,
  // 패싯이 목록보다 앞에 온다 — 경로 길이가 달라 실제로 겹치지는 않지만,
  // 더 구체적인 경로를 먼저 두는 편이 나중에 세그먼트가 늘어도 안전하다.
  adminAccessFacetsHandler,
  adminAccessRequestsHandler,
  adminAccessListHandler,
  adminAccessHistoryHandler,
  adminAccessDetailHandler,
];
