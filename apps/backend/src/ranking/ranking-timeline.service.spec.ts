import type { RankingRepository } from './ranking.repository';
import { RankingTimelineService } from './ranking-timeline.service';
import { RankingYearService } from './ranking-year.service';

const counts = (commitCount: number) => ({
  commitCount,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
});
const member = (githubId: bigint, githubLogin: string, commits: number) => ({
  githubId,
  githubLogin,
  department: null,
  ...counts(commits),
});
const NOW = new Date('2026-03-15T00:00:00.000Z');

function serviceWith(
  members: ReturnType<typeof member>[],
  snapshots: { githubId: bigint; month: number; commits: number }[],
) {
  const repository = {
    findMetrics: jest.fn().mockResolvedValue(members),
    findMonthlySnapshots: jest.fn().mockResolvedValue(
      snapshots.map(({ githubId, month, commits }) => ({
        githubId,
        month,
        ...counts(commits),
      })),
    ),
  } as unknown as RankingRepository;
  return new RankingTimelineService(repository, new RankingYearService());
}

describe('RankingTimelineService', () => {
  it('지난달 값으로 순위를 매기고 마지막 지점은 현재 표 값을 쓴다', async () => {
    const timeline = await serviceWith(
      [member(1n, 'climber', 90), member(2n, 'leader', 50)],
      [
        { githubId: 1n, month: 1, commits: 10 },
        { githubId: 2n, month: 1, commits: 30 },
        { githubId: 1n, month: 3, commits: 999 },
      ],
    ).findTimeline(2026, NOW);

    expect(timeline.months).toEqual([1, 3]);
    expect(timeline.series).toEqual([
      { githubLogin: 'climber', ranks: [2, 1], totals: [10, 90] },
      { githubLogin: 'leader', ranks: [1, 2], totals: [30, 50] },
    ]);
  });

  it('빠진 달은 직전 값을 잇고, 첫 기록 전은 null 이며, 합계 0인 학생은 뺀다', async () => {
    const timeline = await serviceWith(
      [member(1n, 'steady', 40), member(2n, 'late', 20), member(3n, 'idle', 0)],
      [
        { githubId: 1n, month: 1, commits: 10 },
        { githubId: 2n, month: 2, commits: 5 },
      ],
    ).findTimeline(2026, NOW);

    expect(timeline.months).toEqual([1, 2, 3]);
    expect(timeline.series).toEqual([
      { githubLogin: 'steady', ranks: [1, 1, 1], totals: [10, 10, 40] },
      { githubLogin: 'late', ranks: [null, 2, 2], totals: [null, 5, 20] },
    ]);
  });

  it('지난 연도의 마지막 지점은 12월이다', async () => {
    const timeline = await serviceWith([member(1n, 'old', 5)], []).findTimeline(
      2025,
      NOW,
    );

    expect(timeline.months).toEqual([12]);
  });
});
