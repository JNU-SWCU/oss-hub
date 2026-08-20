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

// schemaVersion 2 — 전체 이름(owner/name) 스냅샷이 있어 join 없이 target을 그 이름으로
// 계산한 경우를 미러링한다(REPOSITORY_PUBLISH_METADATA는 반대로 v1/폴백 경우다).
const REPOSITORY_PUBLISH_METADATA_V2 = {
  schemaVersion: 2,
  repositoryId: 'repository-synthetic-2',
  repositoryFullName: 'synthetic-org/synthetic-repo',
  before: { visibility: 'PRIVATE' },
  after: { visibility: 'PUBLIC', publishedAt: '2026-07-24T04:10:00.000Z' },
} as const;

// schemaVersion 2 — 프로그램 이름·신청자 로그인 스냅샷이 있어 join 없이 target을
// composeApplicationTargetLabel 형태("프로그램 이름 · @로그인")로 계산한 경우를
// 미러링한다.
const APPLICATION_DECISION_METADATA_V2 = {
  schemaVersion: 2,
  programName: '합성 프로그램',
  applicantGithubLogin: 'synthetic-applicant',
  before: { status: 'SUBMITTED' },
  after: { status: 'APPROVED' },
} as const;

export const AUDIT_LOG_ACCESS_RECORD_FIXTURE = {
  id: 'audit-access-approved',
  actor: 'synthetic-admin',
  actorHandle: 'synthetic-admin',
  action: 'STAFF_ROLE_REQUEST_APPROVED',
  targetType: 'ROLE_REQUEST',
  targetId: 'request-synthetic-1',
  target: 'synthetic-target-login',
  targetHandle: 'synthetic-target-login',
  occurredAt: '2026-07-24T03:00:00.000Z',
  legacy: false,
  metadata: ACCESS_METADATA_V2,
} as const;

export const AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE = {
  id: 'audit-repository-published',
  actor: 'synthetic-staff',
  actorHandle: 'synthetic-staff',
  action: 'REPOSITORY_PUBLISHED',
  targetType: 'REPOSITORY',
  targetId: 'repository-synthetic-1',
  target: 'REPOSITORY / repository-synthetic-1',
  targetHandle: null,
  occurredAt: '2026-07-24T04:00:00.000Z',
  legacy: false,
  metadata: REPOSITORY_PUBLISH_METADATA,
} as const;

export const AUDIT_LOG_REPOSITORY_PUBLISHED_RESOLVED_RECORD_FIXTURE = {
  id: 'audit-repository-published-resolved',
  actor: 'synthetic-staff',
  actorHandle: 'synthetic-staff',
  action: 'REPOSITORY_PUBLISHED',
  targetType: 'REPOSITORY',
  targetId: 'repository-synthetic-2',
  target: 'synthetic-org/synthetic-repo',
  targetHandle: null,
  occurredAt: '2026-07-24T04:10:00.000Z',
  legacy: false,
  metadata: REPOSITORY_PUBLISH_METADATA_V2,
} as const;

export const AUDIT_LOG_APPLICATION_APPROVED_RECORD_FIXTURE = {
  id: 'audit-application-approved',
  actor: 'synthetic-staff',
  actorHandle: 'synthetic-staff',
  action: 'APPLICATION_APPROVED',
  targetType: 'APPLICATION',
  targetId: 'application-synthetic-1',
  target: '합성 프로그램 · @synthetic-applicant',
  targetHandle: null,
  occurredAt: '2026-07-24T06:00:00.000Z',
  legacy: false,
  metadata: APPLICATION_DECISION_METADATA_V2,
} as const;

export const AUDIT_LOG_LEGACY_RECORD_FIXTURE = {
  id: 'audit-legacy',
  actor: 'synthetic-admin',
  actorHandle: 'synthetic-admin',
  action: 'STAFF_ROLE_REQUEST_APPROVED',
  targetType: 'ROLE_REQUEST',
  targetId: 'request-legacy',
  target: 'ROLE_REQUEST / request-legacy',
  targetHandle: null,
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
