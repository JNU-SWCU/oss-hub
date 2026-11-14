import { PlatformRepository } from '../platform/platform.repository';
import {
  type ProgramActivitySummaryDataSource,
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

describe('program-activity-summary.repository', () => {
  describe('ProgramActivitySummaryRepository', () => {
    it('returns currently linked repositories without applying an archived filter', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { team: { programId: 'program-archived' }, repoId: 101n },
        ]);
      const prisma = {
        teamRepo: { findMany },
      } satisfies ProgramActivitySummaryDataSource;

      const result = await new ProgramActivitySummaryRepository(
        prisma,
      ).findRepositoryLinks(['program-archived']);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          validTo: null,
          team: { programId: { in: ['program-archived'] } },
        },
        select: {
          team: { select: { programId: true } },
          repoId: true,
        },
      });
      expect(result).toEqual([
        {
          programId: 'program-archived',
          githubRepositoryId: 101n,
        },
      ]);
    });

    it('skips repository reads when no program is requested', async () => {
      const findMany = jest.fn();
      const prisma = {
        teamRepo: { findMany },
      } satisfies ProgramActivitySummaryDataSource;

      await expect(
        new ProgramActivitySummaryRepository(prisma).findRepositoryLinks([]),
      ).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
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
