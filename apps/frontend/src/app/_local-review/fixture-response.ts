import { dashboardFixture } from '@/features/dashboard/fixtures';
import type { AuthRole } from '@/features/auth/types';
import {
  AUDIT_LOG_ACCESS_RECORD_FIXTURE,
  AUDIT_LOG_LEGACY_RECORD_FIXTURE,
  AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE,
} from '@/features/audit-log/fixtures';
import type { AuditLogPage, AuditLogRecord } from '@/features/audit-log/types';
import type { StaffDashboardSummary } from '@/features/programs/types';
import { apiPath } from '@/lib/api-client';
import type { LocalReviewFixtureId } from './fixture-contract';

export type LocalReviewResponsePlan =
  | {
      readonly kind: 'json';
      readonly status: number;
      readonly body: unknown;
    }
  | {
      readonly kind: 'delay';
      readonly milliseconds: number;
    };

type LocalReviewRequest = {
  readonly fixture: LocalReviewFixtureId;
  readonly method: string;
  readonly path: string;
  readonly searchParams: URLSearchParams;
};

const STAFF_DASHBOARD_FIXTURE = {
  programs: [
    {
      id: 'program:basic',
      name: '합성 기본 프로그램',
      category: 'BASIC',
      applicationPeriod: {
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-15T23:59:59.000Z',
      },
      applications: {
        total: 3,
        submitted: 1,
        // 승인 대기는 제출됐지만 아직 판정이 안 난 건수다. 합계·제출·승인·반려와
        // 앞뒤가 맞아야 교직원 대시보드의 요약 숫자가 서로 어긋나지 않는다.
        pendingApproval: 1,
        approved: 1,
        rejected: 1,
      },
      applicantsPath: '/staff/programs/program%3Abasic/applicants',
      // 교직원 대시보드가 신청 현황만이 아니라 활동·제출 요약까지 한 화면에서
      // 보여주게 바뀌었다. 셋이 서로 앞뒤가 맞아야 검토자가 화면의 숫자를
      // 의심하지 않는다 — 승인 1건이 곧 제출 대상 1명이다.
      activity: {
        repositories: 1,
        commits: 24,
        pullRequests: 5,
        releases: 1,
        lastActivityAt: '2026-07-30T09:00:00.000Z',
        dataAsOf: '2026-07-31T00:00:00.000Z',
      },
      submissions: {
        approvedApplications: 1,
        milestones: 2,
        total: 2,
        notSubmitted: 1,
        submitted: 1,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    },
    {
      id: 'program:capstone',
      name: '합성 캡스톤 프로그램',
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
      applicantsPath: '/staff/programs/program%3Acapstone/applicants',
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
      submissions: {
        approvedApplications: 0,
        milestones: 0,
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

// 화면 DTO(AuditLogRecord)는 7키지만 backend 가 내려주는 wire record 는 판별 필드
// legacy·metadata 까지 9키다. 파서가 9키를 exact key 로 검증해 하나만 어긋나도
// 던지므로, fixture 가 화면 DTO 만 흉내 내면 HTTP 는 200인데 화면은 "감사 로그를
// 불러오지 못했습니다"·총 0건으로 죽는다. 그래서 wire 계약 쪽을 미러링한다.
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

function json(status: number, body: unknown): LocalReviewResponsePlan {
  return { kind: 'json', status, body };
}

function problem(
  status: number,
  code: string,
  instance: string,
): LocalReviewResponsePlan {
  return json(status, {
    type: 'about:blank',
    title: 'Local review fixture response',
    status,
    detail: 'The selected local review fixture returned an error.',
    instance,
    code,
  });
}

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
      return authenticatedSession(null);
    case 'loading':
      return { kind: 'delay', milliseconds: 60_000 };
    case 'error':
      return problem(503, 'LFX_503', apiPath('auth/session'));
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

export function resolveLocalReviewResponse({
  fixture,
  method,
  path,
  searchParams,
}: LocalReviewRequest): LocalReviewResponsePlan {
  if (method === 'GET' && path === 'auth/session') {
    return sessionResponse(fixture);
  }

  if (
    method === 'GET' &&
    path === 'role-requests/me' &&
    fixture === 'unassigned'
  ) {
    return json(200, null);
  }

  if (
    method === 'GET' &&
    path === 'dashboard/student' &&
    (fixture === 'student' ||
      fixture === 'settings' ||
      fixture === 'wrong-role')
  ) {
    return json(200, dashboardFixture);
  }

  if (
    method === 'GET' &&
    path === 'dashboard/staff/summary' &&
    (fixture === 'staff' || fixture === 'admin')
  ) {
    return json(200, STAFF_DASHBOARD_FIXTURE);
  }

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

  return problem(404, 'LFX_404', apiPath(path));
}
