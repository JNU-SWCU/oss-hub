import { expect, test } from 'vitest';
import type { RankingTimeline, RankingTimelineSeries } from '../types';
import {
  buildRankingHistoryChart,
  formatRankChange,
  rankingHistoryAvatarSlots,
  rankingHistoryLogRows,
  rankingHistoryLogTicks,
  rankingRankChanges,
  type RankingRankChange,
} from './ranking-history-model';

function timelineOf(
  series: readonly RankingTimelineSeries[],
  monthCount = 2,
): RankingTimeline {
  return {
    year: 2026,
    months: Array.from({ length: monthCount }, (_unused, index) => index + 1),
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

test('기록 사이와 연말까지 비어 있는 달을 실제 관측값과 구분한다', () => {
  const chart = buildRankingHistoryChart(
    {
      year: 2026,
      months: [1, 3],
      series: [
        { githubLogin: 'mina', ranks: [1, 1], totals: [10, 40] },
        { githubLogin: 'suho', ranks: [null, 2], totals: [null, 20] },
      ],
    },
    null,
  );

  expect(chart.rows).toEqual([
    { label: '1월', s0: 10, s1: null },
    { label: '2월', s0: null, s1: null },
    { label: '3월', s0: 40, s1: 20 },
    ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({
      label: `${month}월`,
      s0: null,
      s1: null,
    })),
  ]);
  expect(chart.legend[1]).toMatchObject({
    finalRank: 2,
    ranks: [null, null, 2, ...Array<null>(9).fill(null)],
    tipIndex: 2,
  });
});

test('전체 그래프는 연도가 바뀌어도 연결된 달력 범위와 데이터 공백을 표시한다', () => {
  const chart = buildRankingHistoryChart(
    {
      year: 'all',
      periods: [
        { fromMonth: '2025-11', toMonth: '2026-01' },
        { fromMonth: '2026-02', toMonth: '2026-04' },
        { fromMonth: '2026-05', toMonth: '2026-05' },
      ],
      series: [
        { githubLogin: 'mina', ranks: [1, null, 1], totals: [90, null, 110] },
      ],
    },
    null,
  );

  expect(chart.rows).toEqual([
    { label: '2025.11–2026.01', s0: 90 },
    { label: '2026.02–2026.04', s0: null },
    { label: '2026.05', s0: 110 },
  ]);
  expect(chart.legend[0]?.showDot).toBe(true);
});

test('범례는 상위 10명과 열람자만 담고, 열람자 선은 전용 색으로 가장 마지막에 그려진다', () => {
  const chart = buildRankingHistoryChart(
    timelineOf(rankedSeries(300)),
    'student-42',
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
  expect(last?.strokeWidth).toBe(2.8);
  expect(first?.faded).toBe(true);
  expect(first?.strokeWidth).toBe(0.9);
  expect(first?.color).toBe(
    'color-mix(in oklch, var(--muted-foreground) 55%, var(--card))',
  );
});

test('상위 10명은 색이 모두 다르다', () => {
  const chart = buildRankingHistoryChart(timelineOf(rankedSeries(12)), null);
  const colors = chart.legend.map((line) => line.color);

  expect(chart.legend.map((line) => line.strokeWidth)).toEqual([
    2.8, 2.8, 2.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8,
  ]);
  expect(new Set(colors).size).toBe(10);
  expect(colors).not.toContain('var(--chart-3)');
});

test('빈 타임라인에는 계열이나 범례를 생성하지 않는다', () => {
  const chart = buildRankingHistoryChart(timelineOf([], 0), null);

  expect(chart.lines).toEqual([]);
  expect(chart.legend).toEqual([]);
});

test('순위 변화는 직전 수집 순위와 비교해 올림·내림·유지로 갈리고, 직전 수집에 없던 사람은 NEW다', () => {
  const changes = rankingRankChanges([
    { githubLogin: 'climber', previousRank: 5, rank: 2 },
    { githubLogin: 'faller', previousRank: 1, rank: 4 },
    { githubLogin: 'steady', previousRank: 3, rank: 3 },
    { githubLogin: 'unseen', previousRank: null, rank: 6 },
  ]);

  expect(changeText(changes, 'climber')).toBe('▲3');
  expect(changeText(changes, 'faller')).toBe('▼3');
  expect(changeText(changes, 'steady')).toBe('–');
  expect(changeText(changes, 'unseen')).toBe('NEW');
});

test('기록이 한 달뿐인 계열은 선이 그려지지 않으므로 점으로 보여 준다', () => {
  const chart = buildRankingHistoryChart(
    timelineOf([
      { githubLogin: 'rookie', ranks: [null, 2], totals: [null, 5] },
      { githubLogin: 'steady', ranks: [1, 1], totals: [10, 20] },
    ]),
    null,
  );

  expect(
    chart.lines.find((line) => line.githubLogin === 'rookie')?.showDot,
  ).toBe(true);
  expect(
    chart.lines.find((line) => line.githubLogin === 'steady')?.showDot,
  ).toBe(false);
});

test('로그 보기는 0점을 1로 올리고 빈 달은 비워 두며, 눈금은 최고점을 넘지 않는 10의 거듭제곱이다', () => {
  const chart = buildRankingHistoryChart(
    timelineOf([
      { githubLogin: 'mina', ranks: [1, 1], totals: [0, 1200] },
      { githubLogin: 'suho', ranks: [null, 2], totals: [null, 40] },
    ]),
    null,
  );

  expect(rankingHistoryLogRows(chart.rows).slice(0, 2)).toEqual([
    { label: '1월', s0: 1, s1: null },
    { label: '2월', s0: 1200, s1: 40 },
  ]);
  expect(rankingHistoryLogTicks(chart.lines)).toEqual([1, 10, 100, 1000]);
});

test('선 끝 아바타는 겹치지 않게 벌리고 플롯 안에 머문다', () => {
  expect(rankingHistoryAvatarSlots([50, 52, 200], 20, 0, 300)).toEqual([
    50, 70, 200,
  ]);
  expect(rankingHistoryAvatarSlots([295, 300], 20, 0, 300)).toEqual([280, 300]);
  expect(rankingHistoryAvatarSlots([0, 0, 0], 20, 10, 30)).toEqual([
    10, 20, 30,
  ]);
  expect(rankingHistoryAvatarSlots([], 20, 0, 300)).toEqual([]);
});
