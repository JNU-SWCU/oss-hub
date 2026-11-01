import { PlatformRepository } from '../platform/platform.repository';
import {
  type ProgramActivitySummaryDataSource,
  ProgramActivitySummaryRepository,
  ProgramActivityRepository,
} from './program-activity.repository';
import type { PrismaService } from '../platform/prisma.service';

describe('program-activity-summary.repository', () => {
  describe('ProgramActivitySummaryRepository', () => {
    it('returns currently linked repositories without applying an archived filter', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { programId: 'program-archived', githubRepositoryId: 101n },
        ]);
      const prisma = {
        githubRepository: { findMany },
      } satisfies ProgramActivitySummaryDataSource;

      const result = await new ProgramActivitySummaryRepository(
        prisma,
      ).findRepositoryLinks(['program-archived']);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          programId: { in: ['program-archived'] },
          applicationId: { not: null },
        },
        select: { programId: true, githubRepositoryId: true },
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
        githubRepository: { findMany },
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
    const findMany = jest.fn().mockResolvedValue([
      {
        githubRepositoryId: 101n,
        updatedAt,
        lastCompleteInventoryObservedAt: null,
        commits: [],
        pullRequests: [],
        releases: [],
        issues: [{ createdAt: issueCreatedAt }],
      },
    ]);
    const repository = new ProgramActivityRepository(
      {
        githubRepository: { findMany },
      } as unknown as PrismaService,
      new PlatformRepository(),
    );
    const authorWhere = { authorGithubId: 11n };

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
          githubRepositoryId: { in: [101n] },
          OR: [
            { source: 'ORG_PROVISIONED' },
            { source: 'EXTERNAL_PUBLIC', applicationId: { not: null } },
          ],
        },
        select: expect.objectContaining({
          commits: { where: authorWhere, select: { committedAt: true } },
          issues: { where: authorWhere, select: { createdAt: true } },
        }) as unknown,
      }),
    );
  });
});
