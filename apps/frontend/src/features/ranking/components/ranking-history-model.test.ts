import { expect, test } from 'vitest';
import type { RankingTimeline, RankingTimelineSeries } from '../types';
import {
  RANKING_HISTORY_STROKE,
  buildRankingHistoryChart,
  formatRankChange,
  rankingHistoryStrokeWidth,
  rankingPointLabel,
  rankingRankChanges,
  type RankingRankChange,
} from './ranking-history-model';

function timelineOf(
  series: readonly RankingTimelineSeries[],
  options: {
    readonly viewerGithubLogin?: string | null;
    readonly pointCount?: number;
  } = {},
): RankingTimeline {
  const pointCount = options.pointCount ?? 2;
  return {
    year: 2026,
    viewerClass: 'member',
    viewerGithubLogin: options.viewerGithubLogin ?? null,
    dataAsOf: null,
    points: Array.from({ length: pointCount }, (_unused, index) => ({
      date: `2026-${String(index + 1).padStart(2, '0')}-28`,
      starEstimated: false,
    })),
    series,
  };
}

function rankedSeries(count: number): readonly RankingTimelineSeries[] {
  return Array.from({ length: count }, (_unused, index) => ({
    githubLogin: `student-${String(index + 1)}`,
    ranks: [index + 1, index + 1],
    totals: [count - index, (count - index) * 2],
  }));
}

function changeText(
  changes: ReadonlyMap<string, RankingRankChange>,
  login: string,
): string {
  const change = changes.get(login);
  return change === undefined ? 'MISSING' : formatRankChange(change);
}

test.each([
  [1, false, RANKING_HISTORY_STROKE.lead],
  [3, false, RANKING_HISTORY_STROKE.lead],
  [4, false, RANKING_HISTORY_STROKE.legend],
  [10, false, RANKING_HISTORY_STROKE.legend],
  [11, false, RANKING_HISTORY_STROKE.rest],
  [300, true, RANKING_HISTORY_STROKE.lead],
])(
  '%i위(열람자=%s) 선 굵기는 최종 순위로 갈리고 열람자는 언제나 가장 굵다',
  (rank, isViewer, width) => {
    expect(rankingHistoryStrokeWidth(rank, isViewer)).toBe(width);
  },
);

test('행 하나가 지점 하나다 — 계열별 누적 점수를 키로 싣고 빈 달은 null 로 두며 월 이름표를 붙인다', () => {
  const chart = buildRankingHistoryChart(
    timelineOf([
      { githubLogin: 'mina', ranks: [1, 1], totals: [10, 40] },
      { githubLogin: 'suho', ranks: [null, 2], totals: [null, 20] },
    ]),
  );

  expect(chart.rows).toEqual([
    { index: 0, label: '1월', s0: 10, s1: null },
    { index: 1, label: '2월', s0: 40, s1: 20 },
  ]);
  expect(rankingPointLabel('2026-12-31')).toBe('12월');
});

test('범례는 상위 10명과 열람자만 담고, 열람자 선은 전용 색으로 가장 마지막에 그려진다', () => {
  const chart = buildRankingHistoryChart(
    timelineOf(rankedSeries(300), { viewerGithubLogin: 'student-42' }),
  );

  expect(chart.legend.map((line) => line.githubLogin)).toEqual([
    ...Array.from(
      { length: 10 },
      (_unused, index) => `student-${String(index + 1)}`,
    ),
    'student-42',
  ]);
  expect(chart.lines).toHaveLength(300);

  const last = chart.lines.at(-1);
  const first = chart.lines[0];
  expect(last?.githubLogin).toBe('student-42');
  expect(last?.color).toBe('var(--chart-3)');
  expect(last?.faded).toBe(false);
  expect(first?.faded).toBe(true);
  expect(first?.color).toBe(
    'color-mix(in oklch, var(--muted-foreground) 55%, var(--card))',
  );
});

test('상위 10명은 색·선모양 조합이 서로 겹치지 않는다', () => {
  const chart = buildRankingHistoryChart(timelineOf(rankedSeries(12)));
  const identities = chart.legend.map(
    (line) => `${line.color}|${String(line.dash)}`,
  );

  expect(chart.legend.find((line) => line.finalRank === 1)?.color).toBe(
    'var(--chart-1)',
  );
  expect(
    chart.legend.find((line) => line.finalRank === 1)?.dash,
  ).toBeUndefined();
  expect(chart.legend.find((line) => line.finalRank === 4)?.dash).toBe('7 5');
  expect(new Set(identities).size).toBe(identities.length);
});

test('계열이 없으면 행도 없다', () => {
  const chart = buildRankingHistoryChart(timelineOf([], { pointCount: 0 }));

  expect(chart.rows).toEqual([]);
  expect(chart.lines).toEqual([]);
  expect(chart.legend).toEqual([]);
});

test('순위 변화는 직전 지점과 비교해 올림·내림·유지·신규로 갈리고, 비교할 지점이 없으면 말하지 않는다', () => {
  const changes = rankingRankChanges(
    timelineOf([
      { githubLogin: 'climber', ranks: [5, 2], totals: [1, 9] },
      { githubLogin: 'faller', ranks: [1, 4], totals: [9, 9] },
      { githubLogin: 'steady', ranks: [3, 3], totals: [5, 6] },
      { githubLogin: 'rookie', ranks: [null, 6], totals: [null, 2] },
      { githubLogin: 'dropped', ranks: [2, null], totals: [4, null] },
    ]),
  );

  expect(changeText(changes, 'climber')).toBe('▲3');
  expect(changeText(changes, 'faller')).toBe('▼3');
  expect(changeText(changes, 'steady')).toBe('–');
  expect(changeText(changes, 'rookie')).toBe('NEW');
  expect(changeText(changes, 'dropped')).toBe('');
  expect(changeText(changes, 'stranger')).toBe('MISSING');

  expect(
    rankingRankChanges(
      timelineOf([{ githubLogin: 'mina', ranks: [1], totals: [10] }], {
        pointCount: 1,
      }),
    ).size,
  ).toBe(0);
  expect(rankingRankChanges(null).size).toBe(0);
});
