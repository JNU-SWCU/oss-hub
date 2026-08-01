import { dashboardFixture } from '@/features/dashboard/fixtures';
import type { AuthRole } from '@/features/auth/types';
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
        approved: 1,
        rejected: 1,
      },
      applicantsPath: '/staff/programs/program%3Abasic/applicants',
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
        approved: 0,
        rejected: 0,
      },
      applicantsPath: '/staff/programs/program%3Acapstone/applicants',
    },
  ],
} as const satisfies StaffDashboardSummary;

// 감사 로그 화면 DTO(AuditLogRecord)는 7키지만, 백엔드
// (apps/backend/src/audit-log/audit-log.repository.ts)가 실제로 내려주는 wire record는
// 판별 필드 legacy·metadata까지 포함한 9키다. 감사 로그 응답 파서
// (features/audit-log/parser.ts의 parseAuditLogPage)는 이 9키를 exact key로 검증하고
// 하나라도 어긋나면 던지므로, fixture가 화면 DTO만 흉내 내면 HTTP는 200인데 화면은
// "감사 로그를 불러오지 못했습니다"·총 0건으로 죽는다. 그래서 fixture는 화면이 쓰는
// 모양이 아니라 backend wire 계약 쪽을 미러링한다.
//
// wire fixture 원본은 features/audit-log/fixtures.ts지만 이 브랜치에는 그 모듈이 아직
// 없어 import하지 못하고 같은 shape을 여기서 재현한다. metadata는 화면에 흘러가지 않고
// 파서가 파싱 즉시 버리는 값이라 synthetic 값만 담는다(docs/rules/security.md의
// public-safe 규칙: 실명·학번 금지).
type AuditLogWireRecord = AuditLogRecord & {
  readonly legacy: boolean;
  readonly metadata: Record<string, unknown> | null;
};

type AuditLogWirePage = Omit<AuditLogPage, 'items'> & {
  readonly items: readonly AuditLogWireRecord[];
};

const AUDIT_LOG_ACTIONS = [
  'STAFF_ROLE_REQUEST_APPROVED',
  'STAFF_ROLE_REQUEST_REJECTED',
  'STAFF_ROLE_REQUEST_REVOKED',
] as const;

// schemaVersion 2 metadata의 after 스냅샷. action마다 결과 상태가 달라야 metadata가
// action과 앞뒤 맞는 합성 데이터가 된다.
const AUDIT_LOG_RESULT_BY_ACTION = {
  STAFF_ROLE_REQUEST_APPROVED: { role: 'STUDENT', requestStatus: 'APPROVED' },
  STAFF_ROLE_REQUEST_REJECTED: { role: null, requestStatus: 'REJECTED' },
  STAFF_ROLE_REQUEST_REVOKED: { role: null, requestStatus: 'REVOKED' },
} as const satisfies Readonly<
  Record<
    (typeof AUDIT_LOG_ACTIONS)[number],
    { readonly role: string | null; readonly requestStatus: string }
  >
>;

// 감사 로그 기본 limit은 20이다. 로컬 리뷰에서 페이지 이동을 실제로 눌러 볼 수
// 있도록 한 페이지를 넘기는 건수를 둔다 — 20건 이하면 이전·다음이 항상 비활성이라
// 페이지네이션을 검토할 수 없다.
const AUDIT_LOG_FIXTURE_COUNT = 23;

const AUDIT_LOG_FIXTURES: readonly AuditLogWireRecord[] = Array.from(
  { length: AUDIT_LOG_FIXTURE_COUNT },
  (_, index) => {
    const action = AUDIT_LOG_ACTIONS[index % AUDIT_LOG_ACTIONS.length];
    const actor = index % 4 === 0 ? 'synthetic-admin' : 'synthetic-reviewer';
    const targetId = `fixture:role-request:${index + 1}`;
    const base = {
      id: `fixture:audit:${index + 1}`,
      actor,
      action,
      targetType: 'ROLE_REQUEST',
      targetId,
      // 최신순 — 백엔드의 occurredAt desc 정렬과 같은 순서로 둔다.
      occurredAt: `2026-07-${String(AUDIT_LOG_FIXTURE_COUNT - index).padStart(2, '0')}T01:00:00.000Z`,
    } as const;

    // 5건에 한 건은 metadata가 없는 legacy 행이다. 파서가 legacy=true → metadata null,
    // legacy=false → metadata 객체를 서로 다르게 검증하므로, 두 모양이 한 화면에 함께
    // 있어야 계약도 대상 라벨 폴백도 실제로 검토된다.
    if (index % 5 === 4) {
      return {
        ...base,
        // legacy 행은 대상의 GitHub 로그인을 복원할 수 없어 `targetType / targetId` 폴백이다.
        target: `ROLE_REQUEST / ${targetId}`,
        legacy: true,
        metadata: null,
      };
    }

    const targetLogin = `synthetic-target-${index + 1}`;
    const { role, requestStatus } = AUDIT_LOG_RESULT_BY_ACTION[action];
    return {
      ...base,
      // schemaVersion 2 행의 사람이 읽는 대상 라벨 — 대상의 GitHub 로그인이다.
      target: targetLogin,
      legacy: false,
      metadata: {
        schemaVersion: 2,
        eventKind: action,
        actor: { displayName: null, githubLogin: actor },
        target: { displayName: null, githubLogin: targetLogin },
        before: {
          role: null,
          accountStatus: 'ACTIVE',
          requestStatus: 'PENDING',
        },
        after: { role, accountStatus: 'ACTIVE', requestStatus },
      },
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
