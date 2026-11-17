import { AuditLogErrorCode } from './history.error';
import {
  auditRow,
  createAuditLogReadService,
} from './audit-log-mapping.fixture';

const rows = [
  auditRow({
    id: 'newer',
    action: 'STAFF_ROLE_REQUEST_APPROVED',
    targetType: 'ROLE_REQUEST',
    targetId: 'request-2',
    occurredAt: new Date('2026-07-24T02:00:00.000Z'),
  }),
  auditRow({
    id: 'older',
    action: 'STAFF_ROLE_REQUEST_REJECTED',
    targetType: 'ROLE_REQUEST',
    targetId: 'request-1',
    occurredAt: new Date('2026-07-24T01:00:00.000Z'),
  }),
];
const counts = { ACCOUNT: 2, OPERATION: 0, SUBMISSION: 0, LOGIN: 1, SYSTEM: 0 };

function createRepository() {
  return { list: jest.fn().mockResolvedValue({ rows, total: 2, counts }) };
}

describe('AuditLogReadService', () => {
  it('ADMIN 조회는 검색어·분류·액션·기간 필터를 저장소에 전달하고 분류별 건수를 돌려준다', async () => {
    const repository = createRepository();
    const service = createAuditLogReadService(repository);
    const query = {
      q: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      category: 'ACCOUNT' as const,
      from: '2026-07-24',
      to: '2026-07-24',
      page: 1,
      limit: 20,
    };

    const result = await service.list(query);

    expect(repository.list.mock.calls).toEqual([[query]]);
    expect(result.items.map((record) => record.id)).toEqual(['newer', 'older']);
    expect(result).toMatchObject({ page: 1, limit: 20, total: 2, counts });
  });

  it('시작일이 종료일보다 늦으면 400으로 거부한다', async () => {
    const repository = createRepository();
    const service = createAuditLogReadService(repository);

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
    const service = createAuditLogReadService(repository);

    await service.listFromRequest({ q: 'synthetic-admin' });

    expect(repository.list.mock.calls).toEqual([
      [{ q: 'synthetic-admin', page: 1, limit: 20 }],
    ]);
  });
});
