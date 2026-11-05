import { AuditLogErrorCode } from './history.error';
import type { AuditLogRow } from './audit-log-read.repository';
import { AuditLogReadService } from './audit-log-read.service';

const rows: readonly AuditLogRow[] = [
  {
    id: 'newer',
    actor: { nickname: 'synthetic-admin' },
    action: 'STAFF_ROLE_REQUEST_APPROVED',
    targetType: 'ROLE_REQUEST',
    targetId: 'request-2',
    metadata: {},
    historyKind: null,
    joinedTarget: null,
    occurredAt: new Date('2026-07-24T02:00:00.000Z'),
  },
  {
    id: 'older',
    actor: { nickname: 'other-admin' },
    action: 'STAFF_ROLE_REQUEST_REJECTED',
    targetType: 'ROLE_REQUEST',
    targetId: 'request-1',
    metadata: {},
    historyKind: null,
    joinedTarget: null,
    occurredAt: new Date('2026-07-24T01:00:00.000Z'),
  },
];

function createRepository() {
  return { list: jest.fn().mockResolvedValue({ rows, total: 2 }) };
}

describe('AuditLogReadService', () => {
  it('ADMIN 조회는 행위자·액션·기간 필터를 저장소에 전달한다', async () => {
    const repository = createRepository();
    const service = new AuditLogReadService(repository);
    const query = {
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-24',
      to: '2026-07-24',
      page: 1,
      limit: 20,
    };

    const result = await service.list(query);

    expect(repository.list.mock.calls).toEqual([[query]]);
    expect(result.items.map((record) => record.id)).toEqual(['newer', 'older']);
    expect(result).toMatchObject({ page: 1, limit: 20, total: 2 });
  });

  it('시작일이 종료일보다 늦으면 400으로 거부한다', async () => {
    const repository = createRepository();
    const service = new AuditLogReadService(repository);

    await expect(
      service.list({
        from: '2026-07-25',
        to: '2026-07-24',
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: AuditLogErrorCode.INVALID_DATE_RANGE, status: 400 },
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('요청의 빈 페이지 값은 첫 페이지 20건으로 조회한다', async () => {
    const repository = createRepository();
    const service = new AuditLogReadService(repository);

    await service.listFromRequest({ actor: 'synthetic-admin' });

    expect(repository.list.mock.calls).toEqual([
      [{ actor: 'synthetic-admin', page: 1, limit: 20 }],
    ]);
  });
});
