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
  const query = Prisma.sql(strings, ...(call.slice(1) as Prisma.Sql[]));
  return { sql: query.sql, values: query.values };
}

describe('RankingRepository standing read', () => {
  it('ranks student accounts for the requested year and page in one SQL statement', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repository = new RankingRepository({
      user: { count },
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.findRankedPage(
      { currentYear: 2026 },
      { offset: 20, limit: 10 },
      new Date('2026-08-20T00:00:00.000Z'),
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({
      where: { type: UserType.STUDENT, nickname: { not: '' } },
    });
    const call = standingCall(queryRaw);
    expect(call.values).toEqual(expect.arrayContaining([2026, 20, 30]));
    expect(call.sql).toContain('ROW_NUMBER() OVER');
    expect(call.sql).toContain('COLLATE "C"');
    expect(call.sql).not.toContain('github_user_activity_history');
  });

  it('reads only the selected timeline series with hard limits', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        { githubId: 1n, githubLogin: 'mina', rank: 1, total: 3 },
      ])
      .mockResolvedValueOnce([]);
    const repository = new RankingRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.findTimelineSeries(2026, 3, 'mina');

    const [selected, points] = (
      queryRaw.mock.calls as readonly (readonly unknown[])[]
    ).map((call) =>
      Prisma.sql(call[0] as string[], ...(call.slice(1) as Prisma.Sql[])),
    );
    expect(selected?.sql).toContain('LIMIT');
    expect(selected?.values).toEqual(expect.arrayContaining([10, 'mina', 11]));
    expect(points?.sql).toContain('github_user_activity_history');
    expect(points?.values).toEqual(
      expect.arrayContaining([2026, 3, ['1'], 132]),
    );
  });
});
