import { PlatformRepository } from '../platform/platform.repository';
import type { PrismaService } from '../platform/prisma.service';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { RepositoryUrlService } from '../github/repository-url.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
import type { PublicProjectsRepository } from './public-projects.repository';
import {
  type PublicEligibilityService,
  PublicProjectsService,
} from './public-projects.service';

describe('PublicProjectsService.findDetail contributor 합산 (실제 metrics repository)', () => {
  it('drops a contributor who only opened issues and keeps everyone else with their sums', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00.000Z');
    const row = (
      githubId: bigint,
      [commitCount, pullRequestCount, releaseCount]: readonly number[],
    ) => ({
      githubId,
      commitCount,
      pullRequestCount,
      releaseCount,
      updatedAt,
      repository: { githubRepositoryId: 101n },
    });
    const prisma = {
      githubRepository: { findMany: jest.fn().mockResolvedValue([]) },
      contribution: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            row(1n, [2, 0, 0]),
            row(1n, [0, 0, 0]),
            row(2n, [0, 0, 0]),
            row(3n, [0, 0, 1]),
          ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { githubId: 1n, nickname: 'synthetic-committer' },
          { githubId: 3n, nickname: 'synthetic-releaser' },
        ]),
      },
    };
    const service = new PublicProjectsService(
      {
        findById: jest.fn().mockResolvedValue({
          id: 'synthetic-repository',
          projectId: '101',
          githubRepositoryId: 101n,
          nameWithOwner: 'synthetic/repo',
          publishedAt: updatedAt,
          programId: 'synthetic-program',
          programName: 'Synthetic program',
          trackType: null,
          teamName: null,
          teamMemberCount: 1,
          applicantNickname: 'synthetic-committer',
        }),
      } as unknown as PublicProjectsRepository,
      {
        isEligible: jest.fn().mockResolvedValue(true),
      } as unknown as PublicEligibilityService,
      new PublicProjectMetricsRepository(
        prisma as unknown as PrismaService,
        new PlatformRepository(),
      ),
      loadRuntimeConfig({
        SESSION_SECRET: 'synthetic-session-secret-synthetic-session-secret',
      }),
      new RepositoryUrlService(),
    );

    const detail = await service.findDetail('synthetic-repository');

    expect(detail.contributors).toEqual([
      {
        githubLogin: 'synthetic-committer',
        commitCount: 2,
        pullRequestCount: 0,
        releaseCount: 0,
      },
      {
        githubLogin: 'synthetic-releaser',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 1,
      },
    ]);
  });
});
