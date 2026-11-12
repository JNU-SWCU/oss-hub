import { UserType } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';

function standingCall(queryRaw: jest.Mock): {
  readonly sql: string;
  readonly values: readonly unknown[];
} {
  const call =
    (queryRaw.mock.calls as readonly (readonly unknown[])[])[0] ?? [];
  const strings = call[0];
  if (!Array.isArray(strings)) {
    throw new Error('Standing query was not recorded');
  }
  return {
    sql: strings.join(''),
    values: call.slice(1),
  };
}

describe('RankingRepository standing read', () => {
  it('asks for student accounts and the requested year', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new RankingRepository({
      user: { findMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.findMetrics({ currentYear: 2026 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: UserType.STUDENT },
      }),
    );
    const call = standingCall(queryRaw);
    expect(call.values).toContain(2026);
    expect(call.sql).toContain('contributor_standing');
  });

  it('keeps the monthly chart on GithubUserActivityMonthly', async () => {
    const monthlyFindMany = jest.fn().mockResolvedValue([]);
    const queryRaw = jest.fn();
    const repository = new RankingRepository({
      githubUserActivityMonthly: { findMany: monthlyFindMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.findMonthlySnapshots(2026);

    expect(monthlyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { year: 2026 } }),
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
