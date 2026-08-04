import {
  AccountStatus,
  ApplicationStatus,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import {
  ACCESS_AUDIT_EVENT_KINDS,
  ACCESS_AUDIT_SCHEMA_VERSION,
  createAccessAuditMetadata,
  createApplicationDecisionAuditMetadata,
  createCollectionTriggerAuditMetadata,
  createSubmissionFileCleanupAuditMetadata,
  InvalidAuditLogMetadataError,
  parseAuditLogMetadata,
} from './audit-log-metadata';

const STATE = {
  role: Role.STUDENT,
  accountStatus: AccountStatus.ACTIVE,
  requestStatus: null,
} as const;

describe('parseAuditLogMetadata', () => {
  it('레거시 빈 객체 metadata를 legacy 증거로 매핑한다', () => {
    expect(parseAuditLogMetadata({})).toEqual({ legacy: true, metadata: null });
  });

  it('schemaVersion 2(대상 스냅샷 포함) metadata를 그대로 통과시킨다', () => {
    const metadata = createAccessAuditMetadata({
      eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
      actor: { displayName: '합성 관리자', githubLogin: 'synthetic-admin' },
      target: { displayName: '합성 대상', githubLogin: 'synthetic-target' },
      before: STATE,
      after: STATE,
    });

    expect(metadata.schemaVersion).toBe(ACCESS_AUDIT_SCHEMA_VERSION);
    expect(parseAuditLogMetadata(metadata)).toEqual({
      legacy: false,
      metadata,
    });
  });

  it('schemaVersion 1(대상 스냅샷 없음) 과거 metadata를 여전히 허용한다', () => {
    const legacyV1Metadata = {
      schemaVersion: 1,
      eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
      actor: { displayName: '합성 관리자', githubLogin: 'synthetic-admin' },
      before: STATE,
      after: STATE,
    } as const;

    expect(parseAuditLogMetadata(legacyV1Metadata)).toEqual({
      legacy: false,
      metadata: legacyV1Metadata,
    });
  });

  it('schemaVersion 2인데 target 스냅샷이 없으면 거부한다', () => {
    const malformed = {
      schemaVersion: 2,
      eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
      actor: { displayName: '합성 관리자', githubLogin: 'synthetic-admin' },
      before: STATE,
      after: STATE,
    };

    expect(() => parseAuditLogMetadata(malformed)).toThrow(
      InvalidAuditLogMetadataError,
    );
  });

  it('알 수 없는 schemaVersion은 거부한다', () => {
    const malformed = {
      schemaVersion: 3,
      eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
      actor: { displayName: '합성 관리자', githubLogin: 'synthetic-admin' },
      target: { displayName: '합성 대상', githubLogin: 'synthetic-target' },
      before: STATE,
      after: STATE,
    };

    expect(() => parseAuditLogMetadata(malformed)).toThrow(
      InvalidAuditLogMetadataError,
    );
  });

  it('ROLE_REQUEST_REJECTED가 아닌데 rejectionReason이 섞여 있으면 거부한다', () => {
    const malformed = {
      ...createAccessAuditMetadata({
        eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
        actor: { displayName: null, githubLogin: 'synthetic-admin' },
        target: { displayName: null, githubLogin: 'synthetic-target' },
        before: STATE,
        after: STATE,
      }),
      rejectionReason: '섞이면 안 되는 필드',
    };

    expect(() => parseAuditLogMetadata(malformed)).toThrow(
      InvalidAuditLogMetadataError,
    );
  });

  it('RoleRequest 관련 없는 필드 이름·타입이 어긋나면 거부한다', () => {
    expect(() => parseAuditLogMetadata({ schemaVersion: 2 })).toThrow(
      InvalidAuditLogMetadataError,
    );
    expect(() => parseAuditLogMetadata(null)).toThrow(
      InvalidAuditLogMetadataError,
    );
    expect(() => parseAuditLogMetadata('not-an-object')).toThrow(
      InvalidAuditLogMetadataError,
    );
  });
});

describe('createAccessAuditMetadata', () => {
  it('현재 스키마 버전(schemaVersion 2)으로 도장을 찍는다', () => {
    const metadata = createAccessAuditMetadata({
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
      actor: { displayName: null, githubLogin: 'synthetic-admin' },
      target: { displayName: null, githubLogin: 'synthetic-target' },
      before: { ...STATE, requestStatus: RoleRequestStatus.PENDING },
      after: { ...STATE, requestStatus: RoleRequestStatus.REJECTED },
      rejectionReason: '합성 반려 사유',
    });

    expect(metadata.schemaVersion).toBe(2);
    expect(metadata.target).toEqual({
      displayName: null,
      githubLogin: 'synthetic-target',
    });
  });
});

// #547 — 새로 기록하는 세 종류의 metadata를 조회 시점에 다시 읽어낼 수 있어야 한다.
// 읽기 가드가 없으면 목록 조회가 InvalidAuditLogMetadataError로 통째로 깨진다.
describe('parseAuditLogMetadata — #547 신규 typed action', () => {
  it('수집 트리거 metadata를 그대로 읽어낸다', () => {
    const metadata = createCollectionTriggerAuditMetadata({
      runId: 'synthetic-run-id',
    });

    expect(parseAuditLogMetadata(metadata)).toEqual({
      legacy: false,
      metadata: { schemaVersion: 1, runId: 'synthetic-run-id' },
    });
  });

  it('파일 정리 재시도 reset metadata를 그대로 읽어낸다', () => {
    const metadata = createSubmissionFileCleanupAuditMetadata({
      fileId: 'synthetic-file-id',
    });

    expect(parseAuditLogMetadata(metadata)).toEqual({
      legacy: false,
      metadata: { schemaVersion: 1, fileId: 'synthetic-file-id' },
    });
  });

  it('신청 승인·거절 metadata를 그대로 읽어낸다', () => {
    const approved = createApplicationDecisionAuditMetadata({
      before: { status: ApplicationStatus.SUBMITTED },
      after: { status: ApplicationStatus.APPROVED },
    });
    const rejected = createApplicationDecisionAuditMetadata({
      before: { status: ApplicationStatus.SUBMITTED },
      after: { status: ApplicationStatus.REJECTED },
    });

    expect(parseAuditLogMetadata(approved)).toMatchObject({ legacy: false });
    expect(parseAuditLogMetadata(rejected)).toEqual({
      legacy: false,
      metadata: {
        schemaVersion: 1,
        before: { status: ApplicationStatus.SUBMITTED },
        after: { status: ApplicationStatus.REJECTED },
      },
    });
  });

  it('알 수 없는 status가 담긴 판정 metadata는 거부한다', () => {
    expect(() =>
      parseAuditLogMetadata({
        schemaVersion: 1,
        before: { status: 'NOT_A_STATUS' },
        after: { status: ApplicationStatus.APPROVED },
      }),
    ).toThrow(InvalidAuditLogMetadataError);
  });

  // 회귀 방지: 판정 metadata에 반려 사유 원문이 다시 들어오면 여기서 깨진다.
  // `GET /audit-logs`는 metadata를 필드 선별 없이 응답에 싣고(#621), `AuditLog`는
  // append-only라 한 번 쓴 값을 지울 수 없다 — 쓰기 자체를 막는 것이 유일한 방어다.
  it('판정 metadata는 반려 사유 원문을 담지 않는다', () => {
    const rejected = createApplicationDecisionAuditMetadata({
      before: { status: ApplicationStatus.SUBMITTED },
      after: { status: ApplicationStatus.REJECTED },
    });

    expect(Object.keys(rejected).sort()).toEqual([
      'after',
      'before',
      'schemaVersion',
    ]);
    expect(JSON.stringify(rejected)).not.toContain('rejectionReason');
  });

  it('반려 사유 원문이 섞인 판정 metadata는 읽기에서도 거부한다', () => {
    expect(() =>
      parseAuditLogMetadata({
        schemaVersion: 1,
        before: { status: ApplicationStatus.SUBMITTED },
        after: { status: ApplicationStatus.REJECTED },
        rejectionReason: '섞이면 안 되는 사유',
      }),
    ).toThrow(InvalidAuditLogMetadataError);
  });
});
