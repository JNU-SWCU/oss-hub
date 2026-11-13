import { Prisma, UserType } from '@prisma/client';
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
    sql: Prisma.sql(strings, ...(call.slice(1) as Prisma.Sql[])).sql,
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
    expect(call.sql).toContain('DISTINCT ON');
    expect(call.sql).toContain('github_user_activity_history');
  });

  it('reads the monthly chart from the activity history of the year', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = new RankingRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.findMonthlySnapshots(2026);

    const call = standingCall(queryRaw);
    expect(call.values).toContain(2026);
    expect(call.sql).toContain('github_user_activity_history');
  });
});
