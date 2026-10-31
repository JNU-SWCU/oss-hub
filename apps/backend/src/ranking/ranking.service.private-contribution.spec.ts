import { ActivityVisibility } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';
import { RankingYearService } from './ranking-year.service';

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

function row(overrides: Partial<ActivityRow>): ActivityRow {
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

function serviceWith(rows: readonly ActivityRow[]): RankingService {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { githubId: 1n, nickname: 'leader', profile: null },
        { githubId: 2n, nickname: 'climber', profile: null },
        { githubId: 3n, nickname: 'public-only', profile: null },
      ]),
    },
    githubUserActivityHistory: {
      findMany: jest.fn().mockResolvedValue(rows),
      aggregate: jest.fn().mockResolvedValue({ _max: { observedAt: null } }),
    },
  } as unknown as PrismaService;
  return new RankingService(
    new RankingRepository(prisma),
    new RankingYearService(),
  );
}

const PUBLIC_ROWS: readonly ActivityRow[] = [
  row({ githubId: 1n, commitCount: 20, starCount: 1 }),
  row({ githubId: 2n, commitCount: 10, starCount: 2 }),
  row({ githubId: 3n, commitCount: 4, starCount: 1 }),
];

const CLIMBER_PRIVATE: ActivityRow = row({
  githubId: 2n,
  visibility: ActivityVisibility.PRIVATE,
  commitCount: 15,
  pullRequestCount: 3,
});

describe('RankingService — 비공개 기여가 합계와 순위를 바꾼다', () => {
  it('PRIVATE 행이 없으면 PUBLIC 합계 기준 순위다', async () => {
    const page = await serviceWith(PUBLIC_ROWS).findPage(2026, 1, 10, null);

    expect(
      page.items.map(({ githubLogin, rank, total }) => ({
        githubLogin,
        rank,
        total,
      })),
    ).toEqual([
      { githubLogin: 'leader', rank: 1, total: 21 },
      { githubLogin: 'climber', rank: 2, total: 12 },
      { githubLogin: 'public-only', rank: 3, total: 5 },
    ]);
  });

  it('PRIVATE 행이 있는 학생의 total 은 필드별 합이고 순위가 올라간다', async () => {
    for (const rows of [
      [...PUBLIC_ROWS, CLIMBER_PRIVATE],
      [CLIMBER_PRIVATE, ...PUBLIC_ROWS],
    ]) {
      const page = await serviceWith(rows).findPage(2026, 1, 10, null);

      expect(
        page.items.map(({ githubLogin, rank, total }) => ({
          githubLogin,
          rank,
          total,
        })),
      ).toEqual([
        { githubLogin: 'climber', rank: 1, total: 30 },
        { githubLogin: 'leader', rank: 2, total: 21 },
        { githubLogin: 'public-only', rank: 3, total: 5 },
      ]);
      expect(page.items[0]).toMatchObject({
        commitCount: 25,
        pullRequestCount: 3,
        starCount: 2,
      });
    }
  });
});
