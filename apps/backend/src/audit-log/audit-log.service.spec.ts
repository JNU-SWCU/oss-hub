import { AccountStatus, Role } from '@prisma/client';
import { AuditLogErrorCode } from './audit-log-error-code.enum';
import type {
  AuditLogRecordInput,
  AuditLogRepositoryPort,
} from './audit-log.repository';
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
    list: jest.fn().mockResolvedValue([
      {
        id: 'newer',
        actor: 'synthetic-admin',
        action: 'STAFF_ROLE_REQUEST_APPROVED',
        targetType: 'ROLE_REQUEST',
        targetId: 'request-2',
        occurredAt: new Date('2026-07-24T02:00:00.000Z'),
      },
      {
        id: 'older',
        actor: 'other-admin',
        action: 'STAFF_ROLE_REQUEST_REJECTED',
        targetType: 'ROLE_REQUEST',
        targetId: 'request-1',
        occurredAt: new Date('2026-07-24T01:00:00.000Z'),
      },
    ]),
    record: jest.fn((input: AuditLogRecordInput) =>
      Promise.resolve({
        id: 'audit-1',
        actor: 'synthetic-admin',
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        occurredAt: new Date('2026-07-24T03:00:00.000Z'),
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
      from: '2026-07-24T00:00:00.000Z',
      to: '2026-07-24T23:59:59.999Z',
    };

    const result = await service.list(ADMIN_GITHUB_ID, query);

    expect(repository.list.mock.calls).toEqual([[query]]);
    expect(result.map((record) => record.id)).toEqual(['newer', 'older']);
  });

  it('STAFF 조회는 차단한다', async () => {
    const service = new AuditLogService(createRepository());

    await expect(service.list(STAFF_GITHUB_ID, {})).rejects.toMatchObject({
      errorCode: { code: AuditLogErrorCode.ADMIN_ONLY, status: 403 },
    });
  });

  it('시작일이 종료일보다 늦으면 400으로 거부한다', async () => {
    const service = new AuditLogService(createRepository());

    await expect(
      service.list(ADMIN_GITHUB_ID, {
        from: '2026-07-25',
        to: '2026-07-24',
      }),
    ).rejects.toMatchObject({
      errorCode: { code: AuditLogErrorCode.INVALID_DATE_RANGE, status: 400 },
    });
  });

  it('조회 응답에 사용하지 않는 metadata를 노출하지 않는다', async () => {
    const service = new AuditLogService(createRepository());

    const result = await service.list(ADMIN_GITHUB_ID, {});

    expect(result[0]).not.toHaveProperty('metadata');
  });

  it('record 공개 헬퍼는 레코드를 정확히 한 번 생성한다', async () => {
    const repository = createRepository();
    const service = new AuditLogService(repository);
    const input: AuditLogRecordInput = {
      actorGithubId: ADMIN_GITHUB_ID,
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-1',
    };

    await service.record(input);

    expect(repository.record.mock.calls).toEqual([[input]]);
  });
});
