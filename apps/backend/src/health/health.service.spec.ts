import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

type QueryRaw = (query: TemplateStringsArray) => Promise<unknown>;

function buildService(queryRaw: QueryRaw): HealthService {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('HealthService', () => {
  it('SELECT 1이 성공하면 true를 반환한다', async () => {
    const queryRaw = jest
      .fn<Promise<unknown>, [TemplateStringsArray]>()
      .mockResolvedValue([1]);
    const service = buildService(queryRaw);

    const reachable = await service.isDatabaseReachable();

    expect(queryRaw).toHaveBeenCalledWith(['SELECT 1']);
    expect(reachable).toBe(true);
  });

  it('SELECT 1이 실패하면 false를 반환한다', async () => {
    const queryRaw = jest
      .fn<Promise<unknown>, [TemplateStringsArray]>()
      .mockRejectedValue(new Error('synthetic database failure'));
    const service = buildService(queryRaw);

    const reachable = await service.isDatabaseReachable();

    expect(reachable).toBe(false);
  });
});
