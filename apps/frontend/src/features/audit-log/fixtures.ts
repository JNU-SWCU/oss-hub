// apps/backend/src/audit-log/audit-log.repository.ts의 toAuditLogRecord가 실제로
// 만드는 HTTP 응답 모양(legacy/metadata 판별 필드까지 포함)을 그대로 미러링한
// fixture다. AuditLogRecord(features/audit-log/types.ts)는 이 중 라벨 필드(target)만
// 쓰고 metadata는 parser.ts가 파싱 단계에서 버린다 — synthetic 값만 사용한다
// (docs/rules/security.md의 public-safe 규칙: 실명·학번 금지).

const ACCESS_METADATA_V2 = {
  schemaVersion: 2,
  eventKind: 'ROLE_REQUEST_APPROVED',
  actor: { displayName: null, githubLogin: 'synthetic-admin' },
  target: { displayName: null, githubLogin: 'synthetic-target-login' },
  before: { role: null, accountStatus: 'ACTIVE', requestStatus: 'PENDING' },
  after: {
    role: 'STUDENT',
    accountStatus: 'ACTIVE',
    requestStatus: 'APPROVED',
  },
} as const;

const REPOSITORY_PUBLISH_METADATA = {
  schemaVersion: 1,
  repositoryId: 'repository-synthetic-1',
  before: { visibility: 'PRIVATE' },
  after: { visibility: 'PUBLIC', publishedAt: '2026-07-24T04:00:00.000Z' },
} as const;

export const AUDIT_LOG_ACCESS_RECORD_FIXTURE = {
  id: 'audit-access-approved',
  actor: 'synthetic-admin',
  action: 'STAFF_ROLE_REQUEST_APPROVED',
  targetType: 'ROLE_REQUEST',
  targetId: 'request-synthetic-1',
  target: 'synthetic-target-login',
  occurredAt: '2026-07-24T03:00:00.000Z',
  legacy: false,
  metadata: ACCESS_METADATA_V2,
} as const;

export const AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE = {
  id: 'audit-repository-published',
  actor: 'synthetic-staff',
  action: 'REPOSITORY_PUBLISHED',
  targetType: 'REPOSITORY',
  targetId: 'repository-synthetic-1',
  target: 'REPOSITORY / repository-synthetic-1',
  occurredAt: '2026-07-24T04:00:00.000Z',
  legacy: false,
  metadata: REPOSITORY_PUBLISH_METADATA,
} as const;

export const AUDIT_LOG_LEGACY_RECORD_FIXTURE = {
  id: 'audit-legacy',
  actor: 'synthetic-admin',
  action: 'STAFF_ROLE_REQUEST_APPROVED',
  targetType: 'ROLE_REQUEST',
  targetId: 'request-legacy',
  target: 'ROLE_REQUEST / request-legacy',
  occurredAt: '2026-07-24T02:00:00.000Z',
  legacy: true,
  metadata: null,
} as const;

/** `GET /api/v1/audit-logs`의 실제 응답 모양(`{ items, total, page, limit }`). */
export const AUDIT_LOG_PAGE_RESPONSE_FIXTURE = {
  items: [
    AUDIT_LOG_ACCESS_RECORD_FIXTURE,
    AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE,
    AUDIT_LOG_LEGACY_RECORD_FIXTURE,
  ],
  total: 21,
  page: 1,
  limit: 20,
} as const;
