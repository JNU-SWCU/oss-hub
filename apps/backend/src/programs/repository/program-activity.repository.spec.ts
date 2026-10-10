import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramActivityRepository } from './program-activity.repository';

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
    const repository = new ProgramActivityRepository({
      githubRepository: { findMany },
    } as unknown as PrismaService);
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
