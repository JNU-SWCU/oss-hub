import {
  buildRankingTimeline,
  RANKING_TIMELINE_MIN_YEAR,
  withoutZeroTotalSeries,
  type RankingTimelineMetric,
  type RankingTimelineSeries,
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

  it('월별 지점과 마지막 지점을 만들고 캐리포워드·미가입 월 null·월말 1행을 지킨다', () => {
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

  it.each([
    [
      'dataAsOf 의 Asia/Seoul 달력 날짜',
      2026,
      new Date('2026-10-31T15:30:00.000Z'),
      new Date('2026-10-31T15:40:00.000Z'),
      ['2026-11-01'],
    ],
    ['dataAsOf 가 없으면 현재 Seoul 날짜', 2026, null, NOW, ['2026-10-31']],
    [
      '지난 연도는 12-31 이고 12월 스냅샷과 겹치지 않는다',
      2026,
      new Date('2028-05-01T00:00:00.000Z'),
      new Date('2028-05-01T00:00:00.000Z'),
      ['2026-11-30', '2026-12-31'],
    ],
  ])(
    '마지막 지점은 %s 를 쓴다',
    (_label, year, dataAsOf, now, expectedDates) => {
      const timeline = buildRankingTimeline({
        year,
        metrics: [metric(1n, 'alpha', 7)],
        snapshots:
          expectedDates.length > 1
            ? [snapshot(1n, '2026-11-30', 3), snapshot(1n, '2026-12-31', 6)]
            : [],
        dataAsOf,
        now,
      });

      expect(timeline.points.map((point) => point.date)).toEqual(expectedDates);
    },
  );

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

describe('withoutZeroTotalSeries', () => {
  const contributor: RankingTimelineSeries = {
    githubLogin: 'alpha',
    ranks: [1, 1],
    totals: [5, 100],
  };
  const idle: RankingTimelineSeries = {
    githubLogin: 'idle',
    ranks: [2, 2],
    totals: [0, 0],
  };
  const idleViewer: RankingTimelineSeries = {
    githubLogin: 'idle-viewer',
    ranks: [null, 3],
    totals: [null, 0],
  };
  const all = [contributor, idle, idleViewer];

  it.each([
    ['익명 열람자는 0점 계열을 모두 잃는다', null, [contributor]],
    [
      '열람자 자신의 0점 계열만 순위 그대로 남는다',
      'idle-viewer',
      [contributor, idleViewer],
    ],
  ])('%s', (_label, viewer, expected) => {
    expect(withoutZeroTotalSeries(all, viewer)).toEqual(expected);
  });

  it('모두 0점이면 열람자 계열만 남고 익명에게는 빈 배열이다', () => {
    expect(withoutZeroTotalSeries([idle, idleViewer], null)).toEqual([]);
    expect(withoutZeroTotalSeries([idle, idleViewer], 'idle')).toEqual([idle]);
  });
});
