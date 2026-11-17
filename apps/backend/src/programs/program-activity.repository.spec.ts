import { PlatformRepository } from '../platform/platform.repository';
import {
  ProgramActivitySummaryRepository,
  ProgramActivityRepository,
} from './program-activity.repository';
import type { PrismaService } from '../platform/prisma.service';

const stringifyWithBigint = (value: unknown): string => {
  const text = JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
  if (typeof text !== 'string') {
    throw new Error('serialized query calls were empty');
  }
  return text;
};

describe('ProgramActivitySummaryRepository', () => {
  it('aggregates every program in one bounded statement, archived teams included', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = new ProgramActivitySummaryRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.summarizePrograms(['program-a', 'program-b']);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('?');
    expect(sql).toContain('GROUP BY links.program_id');
    expect(sql).toContain('LIMIT');
    expect(sql).not.toContain('archivedAt');
    expect(values).toContain(2);
  });

  it('skips the query when no program is requested', async () => {
    const queryRaw = jest.fn();
    const repository = new ProgramActivitySummaryRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await expect(repository.summarizePrograms([])).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('ProgramActivityRepository.findRepositoryActivity', () => {
  it('reads issues inside the same linked-repository query with the same author filter as commits', async () => {
    const updatedAt = new Date('2026-08-05T00:00:00.000Z');
    const issueCreatedAt = new Date('2026-08-01T00:00:00.000Z');
    const findMany = jest
      .fn()
      .mockResolvedValue([{ githubRepoId: 101n, lastSuccessAt: updatedAt }]);
    const queryRaw = jest.fn().mockResolvedValue([
      {
        repositoryId: 101n,
        kind: 'issue',
        occurredAt: issueCreatedAt,
      },
    ]);
    const repository = new ProgramActivityRepository(
      {
        repo: { findMany },
        $queryRaw: queryRaw,
      } as unknown as PrismaService,
      new PlatformRepository(),
    );

    await expect(
      repository.findRepositoryActivity({
        repositoryIds: [101n],
        authorGithubId: 11n,
      }),
    ).resolves.toEqual([
      {
        repositoryId: 101n,
        dataAsOf: updatedAt,
        commitDates: [],
        pullRequestDates: [],
        releaseDates: [],
        issueDates: [issueCreatedAt],
      },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          githubRepoId: { in: [101n] },
          teamRepos: { some: {} },
        },
      }),
    );
    const serialized = stringifyWithBigint(queryRaw.mock.calls);
    expect(serialized).toContain('author_github_id');
    expect(serialized).toContain('11');
  });
});
