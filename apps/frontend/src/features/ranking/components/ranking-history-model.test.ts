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

test('선 굵기는 최종 순위로 갈린다 — 1~3위 굵게, 4~10위 중간, 그 아래는 얇게', () => {
  expect(rankingHistoryStrokeWidth(1, false)).toBe(RANKING_HISTORY_STROKE.lead);
  expect(rankingHistoryStrokeWidth(3, false)).toBe(RANKING_HISTORY_STROKE.lead);
  expect(rankingHistoryStrokeWidth(4, false)).toBe(
    RANKING_HISTORY_STROKE.legend,
  );
  expect(rankingHistoryStrokeWidth(10, false)).toBe(
    RANKING_HISTORY_STROKE.legend,
  );
  expect(rankingHistoryStrokeWidth(11, false)).toBe(
    RANKING_HISTORY_STROKE.rest,
  );
});

test('열람자 선은 순위가 낮아도 가장 굵다', () => {
  expect(rankingHistoryStrokeWidth(300, true)).toBe(
    RANKING_HISTORY_STROKE.lead,
  );
});

test('지점 날짜는 월 이름표가 된다', () => {
  expect(rankingPointLabel('2026-01-31')).toBe('1월');
  expect(rankingPointLabel('2026-12-31')).toBe('12월');
});

test('행 하나가 지점 하나다 — 계열별 누적 점수를 키로 싣고 빈 달은 null 로 둔다', () => {
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
});

test('범례는 상위 10명과 열람자만 담고 최종 순위로 줄 세운다', () => {
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
});

test('열람자 선은 전용 색과 함께 가장 마지막에 그려진다', () => {
  const chart = buildRankingHistoryChart(
    timelineOf(rankedSeries(300), { viewerGithubLogin: 'student-42' }),
  );
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
  const lineAt = (rank: number) =>
    chart.legend.find((line) => line.finalRank === rank);

  expect(lineAt(1)?.color).toBe('var(--chart-1)');
  expect(lineAt(4)?.color).toBe('var(--chart-1)');
  expect(lineAt(7)?.color).toBe('var(--chart-1)');
  expect(lineAt(10)?.color).toBe('var(--chart-1)');
  expect(lineAt(1)?.dash).toBeUndefined();
  expect(lineAt(4)?.dash).toBe('7 5');
  expect(lineAt(7)?.dash).toBe('2 4');
  expect(lineAt(10)?.dash).toBe('12 4 2 4');

  const identities = chart.legend.map(
    (line) => `${line.color}|${String(line.dash)}`,
  );
  expect(new Set(identities).size).toBe(identities.length);
});

test('계열이 없으면 행도 없다', () => {
  const chart = buildRankingHistoryChart(timelineOf([], { pointCount: 0 }));

  expect(chart.rows).toEqual([]);
  expect(chart.lines).toEqual([]);
  expect(chart.legend).toEqual([]);
});

test('순위 변화는 직전 지점과 비교해 올림·내림·유지·신규로 갈린다', () => {
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
});

test('비교할 직전 지점이 없으면 변화를 말하지 않는다', () => {
  const single = rankingRankChanges(
    timelineOf([{ githubLogin: 'mina', ranks: [1], totals: [10] }], {
      pointCount: 1,
    }),
  );

  expect(single.size).toBe(0);
  expect(rankingRankChanges(null).size).toBe(0);
});
