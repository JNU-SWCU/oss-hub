import type { AuditLogRecord } from '@/features/audit-log/types';
import type {
  AdminUser,
  StaffRoleRequest,
  StaffRoleRequestStatus,
  UserRole,
} from '@/features/roles/types';
import type { SystemStatusResponse } from '@/features/system-status/types';
import {
  accepted,
  bodyEnum,
  bodyString,
  json,
  matchGet,
  matchPath,
  notFound,
  type LocalReviewContext,
  type LocalReviewHandler,
} from '../handler-kit';

/**
 * 관리자 동선의 로컬 검토 응답.
 * 담당 경로: `users`, `users/{id}/role`, `role-requests/{id}`, `audit-logs`,
 * `system-status`. (`role-requests` 목록은 fixture-response가 이미 답한다.)
 *
 * 관리자 전용 화면이라 `admin` 페르소나에만 응답한다. 나머지는 `null`을 돌려
 * 기본 404로 떨어뜨린다.
 */

function isAdmin(context: LocalReviewContext): boolean {
  return context.role === 'ADMIN';
}

/**
 * 관리자 콘솔 사용자 목록.
 *
 * `synthetic-admin`은 세션 픽스처의 관리자 본인이라 `isSelf: true`다.
 * `synthetic-staff`(대기 중 요청)·`synthetic-approved-staff`(승인된 요청)는
 * 교직원 요청 목록 픽스처와 같은 GitHub 핸들을 써서, 두 화면이 같은 사람을
 * 가리키도록 맞춘다.
 */
const ADMIN_USER_FIXTURES = [
  {
    id: 'synthetic-user-admin',
    githubLogin: 'synthetic-admin',
    name: '합성 관리자',
    role: 'ADMIN',
    accountStatus: 'ACTIVE',
    isSelf: true,
  },
  {
    id: 'synthetic-user-approved-staff',
    githubLogin: 'synthetic-approved-staff',
    name: '합성 승인 교직원',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
  },
  {
    id: 'synthetic-user-staff',
    githubLogin: 'synthetic-staff',
    name: '합성 교직원 신청자',
    role: 'STUDENT',
    accountStatus: 'ACTIVE',
    isSelf: false,
  },
  {
    id: 'synthetic-user-11',
    githubLogin: 'synthetic-student-11',
    name: '합성 학생 11',
    role: 'STUDENT',
    accountStatus: 'ACTIVE',
    isSelf: false,
  },
  {
    id: 'synthetic-user-12',
    githubLogin: 'synthetic-student-12',
    name: '합성 학생 12',
    role: 'STUDENT',
    accountStatus: 'DEACTIVATED',
    isSelf: false,
  },
  {
    id: 'synthetic-user-unassigned',
    githubLogin: 'synthetic-unassigned',
    name: null,
    role: null,
    accountStatus: 'ACTIVE',
    isSelf: false,
  },
] as const satisfies readonly AdminUser[];

/**
 * 감사 로그. `action`은 backend `ACCESS_AUDIT_ACTIONS`, `targetType`은
 * `USER`·`ROLE_REQUEST`와 같은 값을 쓴다. `targetId`는 교직원 요청 목록·사용자
 * 목록 픽스처의 id를 그대로 가리킨다.
 */
const AUDIT_LOG_FIXTURES = [
  {
    id: 'synthetic-audit-01',
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_APPROVED',
    targetType: 'ROLE_REQUEST',
    targetId: 'fixture:staff-request:approved',
    occurredAt: '2026-07-21T01:00:00.000Z',
  },
  {
    id: 'synthetic-audit-02',
    actor: 'synthetic-admin',
    action: 'USER_ROLE_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic-user-11',
    occurredAt: '2026-07-18T02:10:00.000Z',
  },
  {
    id: 'synthetic-audit-03',
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_REJECTED',
    targetType: 'ROLE_REQUEST',
    targetId: 'synthetic-role-request-03',
    occurredAt: '2026-07-12T05:30:00.000Z',
  },
  {
    id: 'synthetic-audit-04',
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_REVOKED',
    targetType: 'ROLE_REQUEST',
    targetId: 'synthetic-role-request-04',
    occurredAt: '2026-07-05T07:45:00.000Z',
  },
  {
    id: 'synthetic-audit-05',
    actor: 'synthetic-admin',
    action: 'USER_ACCOUNT_STATUS_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic-user-12',
    occurredAt: '2026-06-28T00:20:00.000Z',
  },
] as const satisfies readonly AuditLogRecord[];

/**
 * 교직원 요청 판정 응답. id는 fixture-response의 `STAFF_REQUEST_FIXTURES`와
 * 같은 값이라 목록에서 누른 행이 그대로 돌아온다.
 */
const STAFF_REQUEST_DECISIONS: Readonly<Record<string, string>> = {
  'fixture:staff-request:pending': 'synthetic-staff',
  'fixture:staff-request:approved': 'synthetic-approved-staff',
};

const SYSTEM_STATUS_FIXTURE = {
  collection: {
    health: 'DELAYED',
    lastCompleteSuccessAt: '2026-07-30T18:00:00.000Z',
    dataAsOf: '2026-07-31T00:00:00.000Z',
    currentRunStatus: 'PROCESSING',
    safeReason: 'STALE_DATA',
  },
} as const satisfies SystemStatusResponse;

function matchesUserFilters(
  user: AdminUser,
  query: string,
  role: string | null,
): boolean {
  const haystack = [user.githubLogin, user.name ?? '']
    .join(' ')
    .toLocaleLowerCase('ko');
  return haystack.includes(query) && (role === null || user.role === role);
}

/** 기간 필터는 한국 날짜 선택기의 `YYYY-MM-DD`라 ISO 앞 10자리와 비교한다. */
function withinPeriod(
  occurredAt: string,
  from: string | null,
  to: string | null,
): boolean {
  const day = occurredAt.slice(0, 10);
  return (from === null || day >= from) && (to === null || day <= to);
}

const adminUsersHandler: LocalReviewHandler = (context) => {
  if (!isAdmin(context) || matchGet(context, 'users') === null) return null;
  const query = (context.searchParams.get('query') ?? '')
    .trim()
    .toLocaleLowerCase('ko');
  const role = context.searchParams.get('role');
  return json(
    200,
    ADMIN_USER_FIXTURES.filter((user) => matchesUserFilters(user, query, role)),
  );
};

const ADMIN_USER_ROLES: readonly UserRole[] = ['STUDENT', 'STAFF', 'ADMIN'];

/**
 * 역할 변경. 요청 본문(`{ role }`, features/roles/api.ts `updateAdminUserRole`)의
 * 역할을 그대로 반영해 돌려준다 — 목록 행이 방금 고른 역할로 바뀌어야 한다.
 *
 * 한계: 저장소가 없어 다음 목록 조회(`GET users`)는 다시 픽스처 기본 역할로
 * 돌아온다. 응답 한 번에 대한 반영이지 상태 변경이 아니다.
 */
const updateUserRoleHandler: LocalReviewHandler = (context) => {
  const params =
    context.method === 'PATCH'
      ? matchPath('users/:id/role', context.path)
      : null;
  if (!isAdmin(context) || params === null) return null;
  const user = ADMIN_USER_FIXTURES.find(
    (candidate) => candidate.id === params.id,
  );
  if (user === undefined) return notFound('ROL_404', context.path);
  // 본문을 못 읽었거나 계약 밖의 값이면 저장 전 역할을 유지한다.
  const nextRole = bodyEnum(context, 'role', ADMIN_USER_ROLES) ?? user.role;
  return accepted({ ...user, role: nextRole } satisfies AdminUser);
};

/** `{ action }`(features/roles/types.ts `StaffRoleRequestDecision`) → 요청 상태. */
const STAFF_REQUEST_ACTION_STATUS: Readonly<
  Record<string, StaffRoleRequestStatus>
> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REVOKE: 'REVOKED',
};

/**
 * 교직원 요청 판정. 승인·반려·회수는 요청 본문의 `action`으로 갈린다 —
 * 반려는 `reason`까지 그대로 돌려줘야 목록의 반려 사유가 방금 입력한 값이 된다.
 *
 * 한계: 판정 결과는 저장되지 않아 목록을 다시 조회하면 픽스처 원래 상태로 돌아온다.
 */
const decideStaffRequestHandler: LocalReviewHandler = (context) => {
  const params =
    context.method === 'PATCH'
      ? matchPath('role-requests/:id', context.path)
      : null;
  if (!isAdmin(context) || params === null) return null;
  const githubLogin = STAFF_REQUEST_DECISIONS[params.id as string];
  if (githubLogin === undefined) return notFound('ROL_404', context.path);
  const action = bodyString(context, 'action') ?? '';
  // 본문을 못 읽으면 승인으로 본다 — 화면이 저장 실패로 멈추는 것보다 낫다.
  const status = STAFF_REQUEST_ACTION_STATUS[action] ?? 'APPROVED';
  const decided = {
    id: params.id as string,
    githubLogin,
    requestedRole: 'STAFF',
    status,
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: '2026-07-31T00:00:00.000Z',
    decidedBy: 'synthetic-admin',
    rejectionReason:
      status === 'REJECTED' ? (bodyString(context, 'reason') ?? '') : null,
  } satisfies StaffRoleRequest;
  return accepted(decided);
};

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

export const ADMIN_HANDLERS: readonly LocalReviewHandler[] = [
  adminUsersHandler,
  updateUserRoleHandler,
  decideStaffRequestHandler,
  auditLogsHandler,
  systemStatusHandler,
];
