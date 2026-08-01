import type { AuditLogRecord } from '@/features/audit-log/types';
import type { SystemStatusResponse } from '@/features/system-status/types';
import {
  json,
  matchGet,
  type LocalReviewContext,
  type LocalReviewHandler,
} from '../handler-kit';

/**
 * 관리자 동선의 로컬 검토 응답.
 * 담당 경로: `audit-logs`, `system-status`.
 *
 * 사용자 목록(`users`)·역할 변경(`users/{id}/role`)·교직원 요청 판정
 * (`role-requests/{id}`) 응답도 여기 있었지만, 그 화면들이 관리자 접근
 * (`/admin/access`) 한 곳으로 합쳐지면서 경로 자체가 사라졌다. 새 화면은
 * `users/access`·`users/access/facets`·`users/{id}/access` 를 읽는데 파서가
 * 엄격해 픽스처를 따로 세워야 한다 — 이 PR 범위 밖이라 후속으로 남긴다.
 *
 * 관리자 전용 화면이라 `admin` 페르소나에만 응답한다. 나머지는 `null`을 돌려
 * 기본 404로 떨어뜨린다.
 */

function isAdmin(context: LocalReviewContext): boolean {
  return context.role === 'ADMIN';
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
    currentRunStatus: 'PROCESSING',
    safeReason: 'STALE_DATA',
  },
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

export const ADMIN_HANDLERS: readonly LocalReviewHandler[] = [
  auditLogsHandler,
  systemStatusHandler,
];
