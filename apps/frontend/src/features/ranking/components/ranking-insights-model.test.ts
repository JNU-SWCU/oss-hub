import { describe, expect, it } from 'vitest';
import type { RankingTimeline, RankingTimelineSeries } from '../types';
import {
  rectsOverlap,
  type Pointer,
  type Rect,
} from './ranking-bump-chart-model';
import {
  bandCrossings,
  bandOf,
  boundariesOf,
  buildGrowthInsights,
  buildMonthRace,
  chartTabPlan,
  debutIndexOf,
  endLabelDelta,
  growthDomain,
  growthEndLabel,
  insightsModeFor,
  monthlyActivity,
  pennantMarks,
  poolAt,
  quantile,
  splitSeries,
  tierTags,
  type BandCrossing,
} from './ranking-insights-model';

const MONTHS = ['2026-01-31', '2026-02-28', '2026-03-19'] as const;

function timelineOf(
  series: readonly RankingTimelineSeries[],
  overrides: Partial<RankingTimeline> = {},
): RankingTimeline {
  return {
    year: 2026,
    viewerClass: 'member',
    viewerGithubLogin: 'me',
    dataAsOf: null,
    points: MONTHS.map((date) => ({ date, starEstimated: false })),
    series,
    ...overrides,
  };
}

function crowdOf(
  totals: readonly (readonly (number | null)[])[],
): RankingTimelineSeries[] {
  return totals.map((row, index) => ({
    githubLogin: `rival-${String(index + 1)}`,
    ranks: row.map((value) => (value === null ? null : index + 1)),
    totals: row,
  }));
}

describe('백분위 구간', () => {
  it('R-7 보간으로 사분위를 계산한다', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 10);
    expect(boundariesOf([1, 2, 3, 4])).toEqual([1.75, 2.5, 3.25, 3.7]);
  });

  it('300명 풀에서도 같은 보간 규칙을 쓴다', () => {
    const pool = Array.from({ length: 300 }, (_unused, index) => index);
    expect(boundariesOf(pool)).toEqual([74.75, 149.5, 224.25, 269.1]);
  });

  it('네 명 미만이면 사분위를 만들지 않는다', () => {
    expect(boundariesOf([])).toBeNull();
    expect(boundariesOf([5])).toBeNull();
    expect(boundariesOf([5, 9])).toBeNull();
    expect(boundariesOf([5, 9, 12])).toBeNull();
    expect(boundariesOf([5, 9, 12, 20])).not.toBeNull();
    expect(quantile([], 0.5)).toBeNull();
  });

  it('참가자 수에 따라 구간 모드를 고른다', () => {
    expect(insightsModeFor(0)).toBe('solo');
    expect(insightsModeFor(1)).toBe('solo');
    expect(insightsModeFor(2)).toBe('envelope');
    expect(insightsModeFor(3)).toBe('envelope');
    expect(insightsModeFor(4)).toBe('tier');
    expect(insightsModeFor(300)).toBe('tier');
  });

  it('경계에 걸친 값은 위 구간으로 올린다', () => {
    const edges = [1.75, 2.5, 3.25, 3.7];
    expect(bandOf(0, edges)).toBe(0);
    expect(bandOf(1.75, edges)).toBe(1);
    expect(bandOf(2.4, edges)).toBe(1);
    expect(bandOf(3.25, edges)).toBe(3);
    expect(bandOf(3.7, edges)).toBe(4);
  });

  it('모두 같은 점수면 전원이 같은 구간에 선다', () => {
    const edges = boundariesOf([5, 5, 5, 5]);
    expect(edges).toEqual([5, 5, 5, 5]);
    expect(edges === null ? null : bandOf(5, edges)).toBe(4);
  });

  it('집계 전인 달은 풀에서 빼고 센다', () => {
    const crowd = crowdOf([
      [null, 4, 9],
      [null, null, 7],
      [1, 2, 3],
    ]);
    expect(poolAt(crowd, 0)).toEqual([1]);
    expect(poolAt(crowd, 1)).toEqual([2, 4]);
    expect(poolAt(crowd, 2)).toEqual([3, 7, 9]);
  });
});

describe('월 활동', () => {
  it('누적 차이를 월 활동으로 바꾼다', () => {
    expect(monthlyActivity([10, 14, 14, 20])).toEqual([10, 4, 0, 6]);
  });

  it('데뷔 달에는 그달까지의 누적을 통째로 귀속한다', () => {
    expect(monthlyActivity([null, null, 12, 15])).toEqual([null, null, 12, 3]);
    expect(debutIndexOf([null, null, 12, 15])).toBe(2);
    expect(debutIndexOf([1, 2])).toBeNull();
  });

  it('데이터 없음과 0점을 구분한다', () => {
    expect(monthlyActivity([null, 0, 0])).toEqual([null, 0, 0]);
    expect(monthlyActivity([])).toEqual([]);
  });

  it('재수집으로 누적이 줄어도 0으로 막는다', () => {
    expect(monthlyActivity([10, 8])).toEqual([10, 0]);
  });
});

describe('구간 진입 스티커', () => {
  const edges = [10, 20, 30, 40];

  it('올라간 구간마다 한 번씩만 스티커를 준다', () => {
    const boundaries = Array.from({ length: 6 }, () => edges);
    expect(bandCrossings([5, 15, 35, 25, 45, 45], boundaries)).toEqual([
      { band: 1, pointIndex: 1 },
      { band: 2, pointIndex: 2 },
      { band: 3, pointIndex: 2 },
      { band: 4, pointIndex: 4 },
    ]);
  });

  it('시작부터 속해 있던 구간은 스티커를 주지 않는다', () => {
    const boundaries = Array.from({ length: 3 }, () => edges);
    expect(bandCrossings([35, 36, 45], boundaries)).toEqual([
      { band: 4, pointIndex: 2 },
    ]);
  });

  it('내려갔다 다시 올라와도 조용하다', () => {
    const boundaries = Array.from({ length: 4 }, () => edges);
    expect(bandCrossings([5, 25, 5, 25], boundaries)).toEqual([
      { band: 1, pointIndex: 1 },
      { band: 2, pointIndex: 1 },
    ]);
  });

  it('구간을 못 만든 달과 집계 전 달은 건너뛴다', () => {
    expect(bandCrossings([1, 2, 35, 45], [null, null, edges, edges])).toEqual([
      { band: 4, pointIndex: 3 },
    ]);
    expect(bandCrossings([null, 45], [edges, edges])).toEqual([]);
  });
});

describe('성장 탭 축과 이름표', () => {
  it('순위 변화를 화살표로 적는다', () => {
    expect(growthEndLabel([3, 1])).toEqual({ rank: 1, delta: 2 });
    expect(endLabelDelta(2)).toBe('▲2');
    expect(endLabelDelta(-2)).toBe('▼2');
    expect(endLabelDelta(0)).toBe('–');
    expect(endLabelDelta(null)).toBe('NEW');
    expect(growthEndLabel([null, 4])).toEqual({ rank: 4, delta: null });
    expect(growthEndLabel([1])).toEqual({ rank: 1, delta: null });
    expect(growthEndLabel([1, null])).toBeNull();
  });

  it('축은 눈금 여섯 칸 안에서 가장 짧게 끝낸다', () => {
    expect(growthDomain(119)).toEqual({
      top: 125,
      ticks: [0, 25, 50, 75, 100, 125],
    });
    expect(growthDomain(100).top).toBe(120);
    expect(growthDomain(10.8)).toEqual({
      top: 12,
      ticks: [0, 2, 4, 6, 8, 10, 12],
    });
    expect(growthDomain(0)).toEqual({ top: 2, ticks: [0, 1, 2] });
    expect(growthDomain(3240).top).toBe(4000);
    for (const peak of [1, 7, 23, 119, 480, 1234, 90_000]) {
      const domain = growthDomain(peak);
      expect(domain.top).toBeGreaterThanOrEqual(peak);
      expect(domain.ticks.length).toBeLessThanOrEqual(7);
      expect(domain.ticks.every((tick) => Number.isInteger(tick))).toBe(true);
    }
  });

  it('1등 합계가 아니라 상위 10% 선까지만 축에 담는다', () => {
    const insights = buildGrowthInsights(
      timelineOf([
        { githubLogin: 'me', ranks: [21, 21, 21], totals: [1, 2, 3] },
        ...crowdOf([
          [10, 20, 900],
          ...Array.from(
            { length: 19 },
            () => [10, 20, 30] as readonly (number | null)[],
          ),
        ]),
      ]),
    );
    expect(insights.mode).toBe('tier');
    expect(insights.cohortSize).toBe(21);
    expect(insights.points[2]?.boundaries?.[3]).toBe(30);
    expect(insights.domainTop).toBe(40);
    expect(insights.viewer?.thisMonth).toBe(1);
  });

  it('참가자가 둘셋이면 전원 범위만 그린다', () => {
    const insights = buildGrowthInsights(
      timelineOf([
        { githubLogin: 'me', ranks: [1, 1, 1], totals: [5, 9, 12] },
        ...crowdOf([[1, 2, 3]]),
      ]),
    );
    expect(insights.mode).toBe('envelope');
    expect(insights.cohortSize).toBe(2);
    expect(insights.points[2]?.low).toBe(3);
    expect(insights.points[2]?.high).toBe(12);
    expect(insights.viewer?.crossings).toEqual([]);
  });

  it('혼자면 구간 없이 내 선만 남는다', () => {
    const insights = buildGrowthInsights(
      timelineOf([{ githubLogin: 'me', ranks: [1, 1, 1], totals: [1, 2, 3] }]),
    );
    expect(insights.mode).toBe('solo');
    expect(insights.points.every((point) => point.boundaries === null)).toBe(
      true,
    );
    expect(insights.viewer?.login).toBe('me');
  });
});

describe('구간 이름표와 깃발 라벨 자리', () => {
  const PLOT = { x: 56, y: 28, width: 1100, height: 320 };
  const EDGES = [10, 20, 30, 40];
  const DOMAIN_TOP = 50;
  const RIGHT = PLOT.x + PLOT.width;
  const SPACING = PLOT.width / 7;

  function yOf(value: number): number {
    return PLOT.y + PLOT.height - (value / DOMAIN_TOP) * PLOT.height;
  }

  function tagsAt(viewerY: number | null) {
    return tierTags({
      edges: EDGES,
      domainTop: DOMAIN_TOP,
      plot: PLOT,
      yOf,
      viewerY,
    });
  }

  function ridgeTag() {
    const tag = tagsAt(null).find((entry) => entry.band === 2);
    if (tag === undefined) throw new Error('ridge tag must be laid out');
    return tag;
  }

  function marksOf(
    crossings: readonly BandCrossing[],
    spots: readonly (Pointer | null)[],
    obstacles: readonly Rect[],
  ) {
    return pennantMarks({
      crossings,
      spotOf: (pointIndex) => spots[pointIndex] ?? null,
      plot: PLOT,
      obstacles,
    });
  }

  it('이름표는 띠 아래쪽에 서고 오른쪽 끝에서 제 글자 폭만큼 자리를 잡는다', () => {
    const tags = tagsAt(null);
    expect(tags.map((tag) => tag.text)).toEqual([
      '베이스캠프 · 하위 25%',
      '숲길 · 상위 50–75%',
      '바위 능선 · 상위 25–50%',
      '설원 · 상위 10–25%',
      '정상 공기 · 상위 10%',
    ]);
    expect(tags.map((tag) => tag.y)).toEqual([339, 275, 211, 147, 83]);
    for (const tag of tags) {
      expect(tag.x).toBe(RIGHT - 10);
      expect(tag.box.x + tag.box.width).toBeCloseTo(tag.x, 10);
      expect(tag.box.width).toBeGreaterThan(60);
    }
  });

  it('내 끝점과 같은 높이의 이름표만 접고 남은 범위는 그대로 둔다', () => {
    expect(tagsAt(ridgeTag().y).map((tag) => tag.band)).toEqual([0, 1, 3, 4]);
    expect(tagsAt(ridgeTag().y).map((tag) => tag.text)).toContain(
      '설원 · 상위 10–25%',
    );
  });

  it('마지막에서 두 번째 달 깃발이 이름표와 같은 높이면 왼쪽 위로 넘긴다', () => {
    const ridge = ridgeTag();
    const boxes = tagsAt(null).map((tag) => tag.box);
    const [mark] = marksOf(
      [{ band: 2, pointIndex: 6 }],
      [
        ...Array.from({ length: 6 }, () => null),
        { x: RIGHT - SPACING, y: ridge.y },
      ],
      boxes,
    );
    if (mark === undefined) throw new Error('pennant must be placed');
    expect(mark.text).toBe('바위 능선!');
    expect(mark.textAnchor).toBe('end');
    expect(mark.y).toBeLessThan(-9);
    expect(boxes.some((box) => rectsOverlap(mark.box, box))).toBe(false);
  });

  it('가장자리에서 먼 깃발은 기본 오른쪽 자리를 지킨다', () => {
    const [mark] = marksOf(
      [{ band: 2, pointIndex: 2 }],
      [null, null, { x: PLOT.x + 344, y: ridgeTag().y }],
      tagsAt(null).map((tag) => tag.box),
    );
    if (mark === undefined) throw new Error('pennant must be placed');
    expect(mark.textAnchor).toBe('start');
    expect(mark.x).toBe(13);
    expect(mark.y).toBe(-9);
  });

  it('마지막 달 깃발도 라벨 상자를 플롯 안에 둔다', () => {
    const [mark] = marksOf(
      [{ band: 1, pointIndex: 7 }],
      [...Array.from({ length: 7 }, () => null), { x: RIGHT, y: yOf(12) }],
      tagsAt(null).map((tag) => tag.box),
    );
    if (mark === undefined) throw new Error('pennant must be placed');
    expect(mark.textAnchor).toBe('end');
    expect(mark.box.x).toBeGreaterThanOrEqual(PLOT.x);
    expect(mark.box.x + mark.box.width).toBeLessThanOrEqual(RIGHT);
  });

  it('같은 달에 두 구간을 넘어도 라벨끼리 겹치지 않는다', () => {
    const [first, second] = marksOf(
      [
        { band: 2, pointIndex: 3 },
        { band: 3, pointIndex: 3 },
      ],
      [null, null, null, { x: PLOT.x + 344, y: ridgeTag().y }],
      [],
    );
    if (first === undefined || second === undefined) {
      throw new Error('both pennants must be placed');
    }
    expect([first.text, second.text]).toEqual(['바위 능선!', '설원!']);
    expect(rectsOverlap(first.box, second.box)).toBe(false);
  });

  it('집계 전 달에는 깃발 자리를 만들지 않는다', () => {
    expect(marksOf([{ band: 2, pointIndex: 0 }], [null], [])).toEqual([]);
  });
});

describe('이번 달 레이스', () => {
  function raceOf(
    series: readonly RankingTimelineSeries[],
    overrides: Partial<RankingTimeline> = {},
  ) {
    const race = buildMonthRace(timelineOf(series, overrides));
    if (race === null) throw new Error('race must be derived');
    return race;
  }

  it('동점은 같은 순위를 나눠 쓰고 전시 순서는 고정된다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [0, 0, 3] },
      { githubLogin: 'bb', ranks: [2, 2, 2], totals: [10, 10, 15] },
      { githubLogin: 'aa', ranks: [3, 3, 3], totals: [20, 20, 25] },
      { githubLogin: 'cc', ranks: [4, 4, 4], totals: [1, 1, 2] },
    ]);
    expect(
      race.racers.map((racer) => [racer.login, racer.score, racer.rank]),
    ).toEqual([
      ['aa', 5, 1],
      ['bb', 5, 1],
      ['me', 3, 3],
      ['cc', 1, 4],
    ]);
    expect(race.podium.map((box) => [box.rank, box.members.length])).toEqual([
      [1, 2],
      [3, 1],
    ]);
  });

  it('한 칸 위까지 몇 점인지 알려준다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 3], totals: [0, 0, 3] },
      { githubLogin: 'bb', ranks: [2, 2, 1], totals: [10, 10, 15] },
      { githubLogin: 'aa', ranks: [3, 3, 2], totals: [20, 20, 25] },
    ]);
    expect(race.nudge).toEqual({ kind: 'climb', gap: 2, next: 'bb' });
    expect(race.summary).toBe(
      '3월 레이스: 나는 +3점으로 3위, 한 칸 위까지 2점.',
    );
  });

  it('선두면 2위와의 차이를 말한다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [0, 0, 9] },
      { githubLogin: 'bb', ranks: [2, 2, 2], totals: [10, 10, 14] },
    ]);
    expect(race.nudge).toEqual({ kind: 'lead', gap: 5 });
    expect(race.podium[0]?.members[0]?.login).toBe('me');
  });

  it('공동 선두는 차이 0으로 읽어준다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [0, 0, 4] },
      { githubLogin: 'bb', ranks: [2, 2, 2], totals: [10, 10, 14] },
    ]);
    expect(race.nudge).toEqual({ kind: 'lead', gap: 0 });
    expect(race.summary).toContain('공동 선두');
  });

  it('전원 0점이면 출발선 상태가 된다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [7, 7, 7] },
      { githubLogin: 'bb', ranks: [2, 2, 2], totals: [5, 5, 5] },
      { githubLogin: 'cc', ranks: [3, 3, 3], totals: [1, 1, 1] },
    ]);
    expect(race.startline).toBe(true);
    expect(race.podium).toEqual([]);
    expect(race.standings).toEqual([]);
    expect(race.nudge).toEqual({ kind: 'start', rank: 1 });
    expect(race.zeroCount).toBe(3);
  });

  it('내 점수가 0이면 꼴찌 대신 출발 전으로 센다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [3, 3, 3], totals: [7, 7, 7] },
      { githubLogin: 'bb', ranks: [1, 1, 1], totals: [5, 5, 15] },
      { githubLogin: 'cc', ranks: [2, 2, 2], totals: [1, 1, 6] },
    ]);
    expect(race.viewer?.score).toBe(0);
    expect(race.nudge).toEqual({ kind: 'start', rank: 3 });
    expect(race.startline).toBe(false);
  });

  it('데뷔 달과 집계 전 참가자를 나눠 센다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [10, 20, 30] },
      { githubLogin: 'bb', ranks: [2, 2, 2], totals: [null, null, 7] },
      {
        githubLogin: 'cc',
        ranks: [null, null, null],
        totals: [null, null, null],
      },
    ]);
    expect(race.racers.map((racer) => racer.login)).toEqual(['me', 'bb']);
    expect(race.racers[1]?.isDebut).toBe(true);
    expect(race.racers[0]?.isDebut).toBe(false);
    expect(race.pendingCount).toBe(1);
    expect(race.debutShown).toBe(true);
  });

  it('1월 한 점만 있으면 그 누적이 그달 점수다', () => {
    const race = raceOf(
      [
        { githubLogin: 'me', ranks: [1], totals: [12] },
        { githubLogin: 'bb', ranks: [2], totals: [3] },
      ],
      { points: [{ date: '2026-01-19', starEstimated: false }] },
    );
    expect(race.month).toBe('1월');
    expect(race.day).toBe('19');
    expect(race.racers[0]?.score).toBe(12);
    expect(race.racers[0]?.isDebut).toBe(false);
  });

  it('300명이면 시상대와 내 주변만 남기고 간격 칩으로 접는다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [40, 40, 40], totals: [0, 0, 40] },
      ...crowdOf(
        Array.from({ length: 299 }, (_unused, index) => [0, 0, 300 - index]),
      ),
    ]);
    expect(race.racers).toHaveLength(300);
    expect(race.standings.map((entry) => entry.kind)).toEqual([
      'gap',
      'row',
      'row',
      'row',
      'gap',
    ]);
    const rows = race.standings.flatMap((entry) =>
      entry.kind === 'row' ? [entry.racer] : [],
    );
    expect(rows[1]?.isViewer).toBe(true);
    expect(race.standings[0]).toEqual({ kind: 'gap', count: 256 });
    expect(race.standings.at(-1)).toEqual({ kind: 'gap', count: 38 });
  });

  it('내가 4위 안쪽이면 바로 다음 순위부터 보여준다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [4, 4, 4], totals: [0, 0, 7] },
      ...crowdOf([
        [0, 0, 10],
        [0, 0, 9],
        [0, 0, 8],
        [0, 0, 6],
        [0, 0, 5],
      ]),
    ]);
    const first = race.standings[0];
    expect(first?.kind).toBe('row');
    expect(first?.kind === 'row' ? first.racer.isViewer : null).toBe(true);
    expect(first?.kind === 'row' ? first.racer.rank : null).toBe(4);
  });

  it('내 활동 리듬에서 신기록과 컴백을 가린다', () => {
    const best = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [2, 4, 20] },
      ...crowdOf([[1, 2, 3]]),
    ]);
    expect(best.rhythm?.personalBest).toBe(true);
    expect(best.rhythm?.max).toBe(16);
    expect(best.rhythm?.maxMonth).toBe('3월');
    expect(best.rhythm?.comeback).toBe(false);

    const comeback = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [9, 9, 12] },
      ...crowdOf([[1, 2, 3]]),
    ]);
    expect(comeback.rhythm?.comeback).toBe(true);
    expect(comeback.rhythm?.personalBest).toBe(false);
  });

  it('첫 달 기록은 신기록으로 치지 않는다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [null, null, 30] },
      ...crowdOf([[1, 2, 3]]),
    ]);
    expect(race.rhythm?.personalBest).toBe(false);
    expect(race.rhythm?.bars.map((bar) => bar.value)).toEqual([null, null, 30]);
  });

  it('공동 최고 달은 가장 이른 달을 집고 공동으로 표시한다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [5, 10, 15] },
      ...crowdOf([[1, 2, 3]]),
    ]);
    expect(race.rhythm?.maxMonth).toBe('1월');
    expect(race.rhythm?.tiedMax).toBe(true);
  });

  it('기록이 전혀 없으면 리듬을 비운다', () => {
    const race = raceOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [0, 0, 0] },
      ...crowdOf([[1, 2, 3]]),
    ]);
    expect(race.rhythm?.empty).toBe(true);
    expect(race.rhythm?.maxMonth).toBeNull();
  });

  it('관전 모드에는 넛지도 리듬도 없다', () => {
    const race = raceOf(
      [
        ...crowdOf([
          [1, 2, 3],
          [2, 3, 9],
        ]),
      ],
      { viewerGithubLogin: null, viewerClass: 'staff' },
    );
    expect(race.viewer).toBeNull();
    expect(race.nudge).toBeNull();
    expect(race.rhythm).toBeNull();
  });
});

describe('올해 0점 참가자 제외', () => {
  it('누적 0점인 사람은 구간과 레이스에서 모두 뺀다', () => {
    const timeline = timelineOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [5, 9, 12] },
      ...crowdOf([
        [1, 2, 3],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ]);
    const split = splitSeries(timeline);
    expect(split.crowd.map((item) => item.githubLogin)).toEqual([
      'me',
      'rival-1',
    ]);
    expect(split.viewerSilent).toBe(false);
    expect(buildGrowthInsights(timeline).mode).toBe('envelope');
    const race = buildMonthRace(timeline);
    expect(race?.racers.map((racer) => racer.login)).toEqual(['me', 'rival-1']);
  });

  it('내가 0점이면 나만은 남기고 구간 인원에서는 뺀다', () => {
    const timeline = timelineOf([
      { githubLogin: 'me', ranks: [5, 5, 5], totals: [0, 0, 0] },
      ...crowdOf([
        [1, 2, 3],
        [2, 4, 6],
        [3, 6, 9],
        [4, 8, 12],
      ]),
    ]);
    const split = splitSeries(timeline);
    expect(split.viewerSilent).toBe(true);
    expect(split.crowd.map((item) => item.githubLogin)).not.toContain('me');
    const insights = buildGrowthInsights(timeline);
    expect(insights.cohortSize).toBe(4);
    expect(insights.viewer?.silent).toBe(true);
    expect(insights.viewer?.thisMonth).toBe(0);
    const race = buildMonthRace(timeline);
    expect(race?.viewer?.score).toBe(0);
    expect(race?.viewer?.rank).toBe(5);
    expect(race?.racers).toHaveLength(5);
  });

  it('나 말고 아무도 점수가 없으면 내 출발선만 그린다', () => {
    const timeline = timelineOf([
      { githubLogin: 'me', ranks: [1, 1, 1], totals: [0, 0, 0] },
      ...crowdOf([
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ]);
    expect(buildGrowthInsights(timeline).mode).toBe('solo');
    const race = buildMonthRace(timeline);
    expect(race?.racers.map((racer) => racer.login)).toEqual(['me']);
    expect(race?.startline).toBe(true);
    expect(chartTabPlan(timeline).tabs).toHaveLength(3);
  });
});

describe('탭 구성', () => {
  it('공개 계층에는 탭을 만들지 않는다', () => {
    expect(
      chartTabPlan(
        timelineOf([{ githubLogin: 'top', ranks: [1, 1, 1] }], {
          viewerClass: 'public',
          viewerGithubLogin: null,
        }),
      ),
    ).toEqual({ tabs: [], active: 'race' });
  });

  it('회원은 내 성장 탭에서 시작한다', () => {
    const plan = chartTabPlan(
      timelineOf([
        { githubLogin: 'me', ranks: [1, 1, 1], totals: [1, 2, 3] },
        ...crowdOf([[1, 1, 1]]),
      ]),
    );
    expect(plan.tabs).toEqual(['growth', 'month', 'race']);
    expect(plan.active).toBe('growth');
  });

  it('참가자가 아닌 운영자는 이번 달 탭에서 시작한다', () => {
    const plan = chartTabPlan(
      timelineOf(crowdOf([[1, 2, 3]]), {
        viewerClass: 'staff',
        viewerGithubLogin: 'staff-only',
      }),
    );
    expect(plan.active).toBe('month');
    expect(plan.tabs).toHaveLength(3);
  });

  it('합계가 없거나 달이 없으면 레이스만 남긴다', () => {
    expect(
      chartTabPlan(timelineOf([{ githubLogin: 'me', ranks: [1, 1, 1] }])).tabs,
    ).toEqual([]);
    expect(chartTabPlan(timelineOf([], { points: [] }))).toEqual({
      tabs: [],
      active: 'race',
    });
  });

  it('그릴 참가자가 아무도 없으면 레이스만 남긴다', () => {
    expect(
      chartTabPlan(
        timelineOf(crowdOf([[0, 0, 0]]), {
          viewerClass: 'staff',
          viewerGithubLogin: null,
        }),
      ).tabs,
    ).toEqual([]);
  });
});
