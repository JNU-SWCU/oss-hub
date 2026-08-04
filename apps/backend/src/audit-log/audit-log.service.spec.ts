import { AccountStatus, Role } from '@prisma/client';
import {
  ACCESS_AUDIT_EVENT_KINDS,
  ACCESS_AUDIT_SCHEMA_VERSION,
  createAccessAuditMetadata,
} from './audit-log-metadata';
import { AuditLogErrorCode } from './audit-log-error-code.enum';
import type {
  AuditLogRecordInput,
  AuditLogRepositoryPort,
} from './audit-log.store';
import { AuditLogService } from './audit-log.service';

const ADMIN_GITHUB_ID = 1001n;
const STAFF_GITHUB_ID = 1002n;

function createRepository(): jest.Mocked<AuditLogRepositoryPort> {
  return {
    findActorByGithubId: jest.fn((githubId) =>
      Promise.resolve({
        id: githubId === ADMIN_GITHUB_ID ? 'admin-id' : 'staff-id',
        role: githubId === ADMIN_GITHUB_ID ? Role.ADMIN : Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
      }),
    ),
    list: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'newer',
          actor: 'synthetic-admin',
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-2',
          target: 'ROLE_REQUEST / request-2',
          occurredAt: new Date('2026-07-24T02:00:00.000Z'),
          legacy: true,
          metadata: null,
        },
        {
          id: 'older',
          actor: 'other-admin',
          action: 'STAFF_ROLE_REQUEST_REJECTED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-1',
          target: 'ROLE_REQUEST / request-1',
          occurredAt: new Date('2026-07-24T01:00:00.000Z'),
          legacy: true,
          metadata: null,
        },
      ],
      total: 2,
    }),
    record: jest.fn((input: AuditLogRecordInput) =>
      Promise.resolve({
        id: 'audit-1',
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        target:
          input.metadata.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION
            ? input.metadata.target.githubLogin
            : `${input.targetType} / ${input.targetId}`,
        occurredAt: new Date('2026-07-24T03:00:00.000Z'),
        actor:
          'actor' in input.metadata
            ? input.metadata.actor.githubLogin
            : 'synthetic-actor',
        legacy: false,
        metadata: input.metadata,
      }),
    ),
  };
}

describe('AuditLogService', () => {
  it('ADMIN 조회는 행위자·액션·기간 필터를 저장소에 전달한다', async () => {
    const repository = createRepository();
    const service = new AuditLogService(repository);
    const query = {
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-24',
      to: '2026-07-24',
      page: 1,
      limit: 20,
    };

    const result = await service.list(ADMIN_GITHUB_ID, query);

    expect(repository.list.mock.calls).toEqual([[query]]);
    expect(result.items.map((record) => record.id)).toEqual(['newer', 'older']);
    expect(result).toMatchObject({ page: 1, limit: 20, total: 2 });
  });

  it('STAFF 조회는 차단한다', async () => {
    const service = new AuditLogService(createRepository());

    await expect(
      service.list(STAFF_GITHUB_ID, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({
      errorCode: { code: AuditLogErrorCode.ADMIN_ONLY, status: 403 },
    });
  });

  it('시작일이 종료일보다 늦으면 400으로 거부한다', async () => {
    const service = new AuditLogService(createRepository());

    await expect(
      service.list(ADMIN_GITHUB_ID, {
        from: '2026-07-25',
        to: '2026-07-24',
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: AuditLogErrorCode.INVALID_DATE_RANGE, status: 400 },
    });
  });

  it('record 공개 헬퍼는 레코드를 정확히 한 번 생성한다', async () => {
    const repository = createRepository();
    const service = new AuditLogService(repository);
    const input: AuditLogRecordInput = {
      actorGithubId: ADMIN_GITHUB_ID,
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-1',
      metadata: createAccessAuditMetadata({
        eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
        actor: {
          displayName: '합성 관리자',
          githubLogin: 'synthetic-admin',
        },
        target: {
          displayName: '합성 대상',
          githubLogin: 'synthetic-target',
        },
        before: {
          role: null,
          accountStatus: AccountStatus.ACTIVE,
          requestStatus: null,
        },
        after: {
          role: Role.STAFF,
          accountStatus: AccountStatus.ACTIVE,
          requestStatus: null,
        },
      }),
    };

    await service.record(input);

    expect(repository.record.mock.calls).toEqual([[input]]);
  });
});
