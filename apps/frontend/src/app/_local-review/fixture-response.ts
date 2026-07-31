import { dashboardFixture } from '@/features/dashboard/fixtures';
import type { AuthRole } from '@/features/auth/types';
import type { StaffDashboardSummary } from '@/features/programs/types';
import type {
  StaffRoleRequest,
  StaffRoleRequestPage,
} from '@/features/roles/types';
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

const STAFF_REQUEST_FIXTURES = [
  {
    id: 'fixture:staff-request:pending',
    githubLogin: 'synthetic-staff',
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
  },
  {
    id: 'fixture:staff-request:approved',
    githubLogin: 'synthetic-approved-staff',
    requestedRole: 'STAFF',
    status: 'APPROVED',
    requestedAt: '2026-07-20T00:00:00.000Z',
    decidedAt: '2026-07-21T01:00:00.000Z',
    decidedBy: 'synthetic-admin',
    rejectionReason: null,
  },
] as const satisfies readonly StaffRoleRequest[];

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

function staffRequestPage(searchParams: URLSearchParams): StaffRoleRequestPage {
  const status = searchParams.get('status') ?? 'PENDING';
  const query = (searchParams.get('query') ?? '').trim().toLowerCase();
  const items = STAFF_REQUEST_FIXTURES.filter(
    (request) =>
      request.status === status &&
      (query === '' || request.githubLogin.toLowerCase().includes(query)),
  );
  return {
    items,
    page: Number(searchParams.get('page') ?? '1'),
    limit: Number(searchParams.get('limit') ?? '20'),
    total: items.length,
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

  if (
    method === 'GET' &&
    path === 'role-requests' &&
    fixture === 'admin'
  ) {
    return json(200, staffRequestPage(searchParams));
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
