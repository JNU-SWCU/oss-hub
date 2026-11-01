import { ActivityVisibility } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';

interface ActivityRow {
  githubId: bigint;
  year: number;
  visibility: ActivityVisibility;
  commitCount: number;
  pullRequestCount: number;
  issueCount: number;
  repositoryCount: number;
  starCount: number;
}

function activity(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    githubId: 1n,
    year: 2026,
    visibility: ActivityVisibility.PUBLIC,
    commitCount: 0,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    ...overrides,
  };
}

function repositoryWith(rows: readonly ActivityRow[]): RankingRepository {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { githubId: 1n, nickname: 'with-private', profile: null },
        { githubId: 2n, nickname: 'public-only', profile: null },
      ]),
    },
    githubUserActivityHistory: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaService;
  return new RankingRepository(prisma);
}

describe('RankingRepository.findMetrics — PUBLIC+PRIVATE 합산', () => {
  it('PRIVATE 행이 있으면 필드별로 합산하고 별은 PUBLIC 값만 쓴다', async () => {
    const publicRow = activity({
      commitCount: 10,
      pullRequestCount: 4,
      issueCount: 2,
      repositoryCount: 3,
      starCount: 9,
    });
    const privateRow = activity({
      visibility: ActivityVisibility.PRIVATE,
      commitCount: 5,
      pullRequestCount: 1,
      issueCount: 1,
      repositoryCount: 2,
    });

    for (const rows of [
      [publicRow, privateRow],
      [privateRow, publicRow],
    ]) {
      const result = await repositoryWith(rows).findMetrics({
        currentYear: 2026,
      });
      expect(result.find((row) => row.githubId === 1n)).toMatchObject({
        commitCount: 15,
        pullRequestCount: 5,
        issueCount: 3,
        repositoryCount: 5,
        starCount: 9,
      });
    }
  });

  it('PRIVATE 행만 있어도 별은 0이다', async () => {
    const result = await repositoryWith([
      activity({
        visibility: ActivityVisibility.PRIVATE,
        commitCount: 3,
        starCount: 4,
      }),
    ]).findMetrics({ currentYear: 2026 });

    expect(result.find((row) => row.githubId === 1n)).toMatchObject({
      commitCount: 3,
      starCount: 0,
    });
  });

  it('PRIVATE 행이 없는 학생(옛 PUBLIC 행만)은 기존 값 그대로다', async () => {
    const result = await repositoryWith([
      activity({
        githubId: 2n,
        year: 2024,
        commitCount: 6,
        starCount: 2,
      }),
      activity({
        githubId: 2n,
        year: 2025,
        commitCount: 4,
        starCount: 5,
      }),
      activity({
        githubId: 1n,
        visibility: ActivityVisibility.PRIVATE,
        commitCount: 8,
      }),
    ]).findMetrics({});

    expect(result.find((row) => row.githubId === 2n)).toMatchObject({
      commitCount: 10,
      starCount: 5,
    });
  });
});
