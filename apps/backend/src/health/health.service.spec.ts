import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

type QueryRaw = (query: TemplateStringsArray) => Promise<unknown>;

function buildService(queryRaw: QueryRaw): HealthService {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('HealthService', () => {
  it('SELECT 1이 성공하면 true를 반환한다', async () => {
    // Given: PostgreSQL 연결 확인 쿼리가 성공한다.
    const queryRaw = jest
      .fn<Promise<unknown>, [TemplateStringsArray]>()
      .mockResolvedValue([1]);
    const service = buildService(queryRaw);

    // When: 데이터베이스 도달 가능 여부를 확인한다.
    const reachable = await service.isDatabaseReachable();

    // Then: SELECT 1을 한 번 실행하고 true를 반환한다.
    expect(queryRaw).toHaveBeenCalledWith(['SELECT 1']);
    expect(reachable).toBe(true);
  });

  it('SELECT 1이 실패하면 false를 반환한다', async () => {
    // Given: PostgreSQL 연결 확인 쿼리가 실패한다.
    const queryRaw = jest
      .fn<Promise<unknown>, [TemplateStringsArray]>()
      .mockRejectedValue(new Error('synthetic database failure'));
    const service = buildService(queryRaw);

    // When: 데이터베이스 도달 가능 여부를 확인한다.
    const reachable = await service.isDatabaseReachable();

    // Then: 예외를 흘리지 않고 false로 변환한다.
    expect(reachable).toBe(false);
  });
});
