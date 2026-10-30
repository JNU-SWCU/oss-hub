import {
  buildRankingTimeline,
  RANKING_TIMELINE_MIN_YEAR,
  type RankingTimelineMetric,
  type RankingTimelineSnapshot,
} from './ranking-timeline';

const NOW = new Date('2026-10-31T03:00:00.000Z');
const DATA_AS_OF = new Date('2026-10-31T02:00:00.000Z');

function metric(
  githubId: bigint,
  githubLogin: string,
  commitCount: number,
): RankingTimelineMetric {
  return {
    githubId,
    githubLogin,
    commitCount,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
  };
}

function snapshot(
  githubId: bigint,
  date: string,
  commitCount: number,
  starEstimated = false,
): RankingTimelineSnapshot {
  return {
    githubId,
    snapshotDate: new Date(`${date}T00:00:00.000Z`),
    commitCount,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    starEstimated,
  };
}

describe('buildRankingTimeline', () => {
  const metrics = [
    metric(1n, 'alpha', 100),
    metric(2n, 'bravo', 50),
    metric(3n, 'carol', 10),
  ];
  const snapshots = [
    snapshot(1n, '2026-01-31', 5),
    snapshot(1n, '2026-03-31', 30),
    snapshot(2n, '2026-01-20', 1),
    snapshot(2n, '2026-01-31', 9),
    snapshot(3n, '2026-03-15', 20),
  ];

  it('월별 지점과 마지막 지점을 만들고 캐리포워드·미가입 월 null 을 지킨다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics,
      snapshots,
      dataAsOf: DATA_AS_OF,
      now: NOW,
    });

    expect(timeline.points).toEqual([
      { date: '2026-01-31', starEstimated: false },
      { date: '2026-03-31', starEstimated: false },
      { date: '2026-10-31', starEstimated: false },
    ]);
    expect(timeline.series).toEqual([
      { githubLogin: 'alpha', ranks: [2, 1, 1], totals: [5, 30, 100] },
      { githubLogin: 'bravo', ranks: [1, 3, 2], totals: [9, 9, 50] },
      { githubLogin: 'carol', ranks: [null, 2, 3], totals: [null, 20, 10] },
    ]);
  });

  it('첫 스냅샷 이전 달에는 순위가 없고 그 달 순위 경쟁에서도 빠진다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics,
      snapshots,
      dataAsOf: DATA_AS_OF,
      now: NOW,
    });

    const january = timeline.series.map((series) => series.ranks[0]);
    expect(january).toEqual([2, 1, null]);
    expect(january.filter((rank) => rank !== null)).toHaveLength(2);
  });

  it('같은 달에 여러 스냅샷이 있으면 가장 늦은 행만 쓴다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(2n, 'bravo', 50)],
      snapshots: [snapshot(2n, '2026-01-20', 1), snapshot(2n, '2026-01-31', 9)],
      dataAsOf: DATA_AS_OF,
      now: NOW,
    });

    expect(timeline.series[0]?.totals[0]).toBe(9);
  });

  it('마지막 지점 날짜는 dataAsOf 의 Asia/Seoul 달력 날짜다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(1n, 'alpha', 1)],
      snapshots: [],
      dataAsOf: new Date('2026-10-31T15:30:00.000Z'),
      now: new Date('2026-10-31T15:40:00.000Z'),
    });

    expect(timeline.points).toEqual([
      { date: '2026-11-01', starEstimated: false },
    ]);
  });

  it('dataAsOf 가 없으면 현재 시각의 Seoul 날짜를 마지막 지점으로 쓴다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(1n, 'alpha', 1)],
      snapshots: [],
      dataAsOf: null,
      now: NOW,
    });

    expect(timeline.points).toEqual([
      { date: '2026-10-31', starEstimated: false },
    ]);
  });

  it('지난 연도의 마지막 지점은 12-31 이고 12월 스냅샷을 중복 지점으로 만들지 않는다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(1n, 'alpha', 7)],
      snapshots: [snapshot(1n, '2026-11-30', 3), snapshot(1n, '2026-12-31', 6)],
      dataAsOf: new Date('2028-05-01T00:00:00.000Z'),
      now: new Date('2028-05-01T00:00:00.000Z'),
    });

    expect(timeline.points.map((point) => point.date)).toEqual([
      '2026-11-30',
      '2026-12-31',
    ]);
    expect(timeline.series[0]?.totals).toEqual([3, 7]);
  });

  it('starEstimated 는 그 달 스냅샷의 OR 이고 캐리포워드는 이전 값을 물려받는다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(1n, 'alpha', 20), metric(2n, 'bravo', 10)],
      snapshots: [
        snapshot(1n, '2026-01-31', 5, true),
        snapshot(2n, '2026-02-28', 7, false),
        snapshot(1n, '2026-03-31', 9, false),
        snapshot(2n, '2026-03-31', 8, false),
      ],
      dataAsOf: DATA_AS_OF,
      now: NOW,
    });

    expect(timeline.points).toEqual([
      { date: '2026-01-31', starEstimated: true },
      { date: '2026-02-28', starEstimated: true },
      { date: '2026-03-31', starEstimated: false },
      { date: '2026-10-31', starEstimated: false },
    ]);
  });

  it('랭킹 대상이 아닌 사용자의 스냅샷은 지점도 순위도 만들지 않는다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(1n, 'alpha', 20)],
      snapshots: [snapshot(99n, '2026-02-28', 7)],
      dataAsOf: DATA_AS_OF,
      now: NOW,
    });

    expect(timeline.points).toEqual([
      { date: '2026-10-31', starEstimated: false },
    ]);
    expect(timeline.series).toEqual([
      { githubLogin: 'alpha', ranks: [1], totals: [20] },
    ]);
  });

  it(`${RANKING_TIMELINE_MIN_YEAR} 이전 연도와 빈 모집단은 빈 타임라인이다`, () => {
    expect(
      buildRankingTimeline({
        year: RANKING_TIMELINE_MIN_YEAR - 1,
        metrics,
        snapshots,
        dataAsOf: DATA_AS_OF,
        now: NOW,
      }),
    ).toEqual({ points: [], series: [] });
    expect(
      buildRankingTimeline({
        year: 2026,
        metrics: [],
        snapshots,
        dataAsOf: DATA_AS_OF,
        now: NOW,
      }),
    ).toEqual({ points: [], series: [] });
  });

  it('동점이면 표와 같은 타이브레이크로 정렬한다', () => {
    const timeline = buildRankingTimeline({
      year: 2026,
      metrics: [metric(9n, 'Zulu', 5), metric(4n, 'alpha', 5)],
      snapshots: [],
      dataAsOf: DATA_AS_OF,
      now: NOW,
    });

    expect(timeline.series.map((series) => series.githubLogin)).toEqual([
      'alpha',
      'Zulu',
    ]);
  });
});
