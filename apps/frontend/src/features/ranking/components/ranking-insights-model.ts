import {
  RANKING_VIEWER_CLASSES,
  type RankingTimeline,
  type RankingTimelinePoint,
  type RankingTimelineSeries,
} from '../types';
import { monthLabel, pointLabel } from './ranking-bump-chart-model';

const RANKING_CHART_TABS = ['growth', 'month', 'race'] as const;

export type RankingChartTab = (typeof RANKING_CHART_TABS)[number];

const MIN_TIER_POOL = 4;
export const SUMMIT_BAND = 4;

const BAND_PERCENTILES = [0.25, 0.5, 0.75, 0.9] as const;
const PODIUM_RANKS = [1, 2, 3] as const;
const STANDINGS_WINDOW = 3;
const STEP_FACTORS = [1, 2, 2.5, 5] as const;
const MAX_TICK_SPANS = 6;
const MAX_STEP_EXPONENT = 12;
const DOMAIN_HEADROOM = 1.04;
const PERSONAL_BEST_HISTORY = 2;
const ENVELOPE_MIN_POOL = 2;

export interface BandTier {
  readonly name: string;
  readonly range: string;
}

export const BAND_TIERS: readonly BandTier[] = [
  { name: '베이스캠프', range: '하위 25%' },
  { name: '숲길', range: '상위 50–75%' },
  { name: '바위 능선', range: '상위 25–50%' },
  { name: '설원', range: '상위 10–25%' },
  { name: '정상 공기', range: '상위 10%' },
];

export type InsightsMode = 'tier' | 'envelope' | 'solo';

export interface BandCrossing {
  readonly band: number;
  readonly pointIndex: number;
}

export interface GrowthPoint {
  readonly label: string;
  readonly month: string;
  readonly starEstimated: boolean;
  readonly boundaries: readonly number[] | null;
  readonly median: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly poolSize: number;
}

export interface GrowthEndLabel {
  readonly rank: number;
  readonly delta: number | null;
}

interface GrowthViewer {
  readonly login: string;
  readonly totals: readonly (number | null)[];
  readonly activity: readonly (number | null)[];
  readonly bands: readonly (number | null)[];
  readonly crossings: readonly BandCrossing[];
  readonly endLabel: GrowthEndLabel | null;
  readonly thisMonth: number | null;
  readonly debutIndex: number | null;
  readonly silent: boolean;
}

export interface GrowthInsights {
  readonly mode: InsightsMode;
  readonly cohortSize: number;
  readonly points: readonly GrowthPoint[];
  readonly viewer: GrowthViewer | null;
  readonly domainTop: number;
  readonly ticks: readonly number[];
  readonly freshCrossing: BandCrossing | null;
  readonly summited: boolean;
  readonly estimated: boolean;
}

export interface MonthRacer {
  readonly login: string;
  readonly score: number;
  readonly rank: number;
  readonly total: number;
  readonly isViewer: boolean;
  readonly isDebut: boolean;
}

export interface PodiumBox {
  readonly rank: number;
  readonly members: readonly MonthRacer[];
}

type StandingsEntry =
  | { readonly kind: 'row'; readonly racer: MonthRacer }
  | { readonly kind: 'gap'; readonly count: number };

type MonthNudge =
  | { readonly kind: 'climb'; readonly gap: number; readonly next: string }
  | { readonly kind: 'lead'; readonly gap: number | null }
  | { readonly kind: 'start'; readonly rank: number };

interface RhythmBar {
  readonly index: number;
  readonly month: string;
  readonly value: number | null;
  readonly isMax: boolean;
  readonly isCurrent: boolean;
}

export interface Rhythm {
  readonly bars: readonly RhythmBar[];
  readonly max: number;
  readonly maxMonth: string | null;
  readonly tiedMax: boolean;
  readonly empty: boolean;
  readonly personalBest: boolean;
  readonly comeback: boolean;
}

export interface MonthRace {
  readonly month: string;
  readonly day: string;
  readonly racers: readonly MonthRacer[];
  readonly podium: readonly PodiumBox[];
  readonly standings: readonly StandingsEntry[];
  readonly nudge: MonthNudge | null;
  readonly viewer: MonthRacer | null;
  readonly rhythm: Rhythm | null;
  readonly startline: boolean;
  readonly zeroCount: number;
  readonly pendingCount: number;
  readonly debutShown: boolean;
  readonly estimated: boolean;
  readonly summary: string;
}

export interface SeriesSplit {
  readonly crowd: readonly RankingTimelineSeries[];
  readonly viewer: RankingTimelineSeries | null;
  readonly viewerSilent: boolean;
}

function totalAt(series: RankingTimelineSeries, index: number): number | null {
  const totals = series.totals;
  if (totals === undefined) return null;
  return totals[index] ?? null;
}

function compareLogin(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function hasTotals(series: readonly RankingTimelineSeries[]): boolean {
  return series.some((item) => item.totals !== undefined);
}

export function splitSeries(timeline: RankingTimeline): SeriesSplit {
  const lastIndex = timeline.points.length - 1;
  const viewer =
    timeline.viewerGithubLogin === null
      ? null
      : (timeline.series.find(
          (item) =>
            item.githubLogin === timeline.viewerGithubLogin &&
            item.totals !== undefined,
        ) ?? null);
  return {
    crowd: timeline.series.filter(
      (item) => item.totals !== undefined && totalAt(item, lastIndex) !== 0,
    ),
    viewer,
    viewerSilent: viewer !== null && totalAt(viewer, lastIndex) === 0,
  };
}

export function monthlyActivity(
  totals: readonly (number | null)[],
): (number | null)[] {
  return totals.map((value, index) => {
    if (value === null) return null;
    const previous = index === 0 ? null : (totals[index - 1] ?? null);
    if (previous === null) return value;
    return Math.max(0, value - previous);
  });
}

export function quantile(
  sorted: readonly number[],
  ratio: number,
): number | null {
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const low = sorted[lower];
  if (low === undefined) return null;
  const high = sorted[lower + 1];
  return high === undefined ? low : low + (position - lower) * (high - low);
}

export function poolAt(
  series: readonly RankingTimelineSeries[],
  index: number,
): number[] {
  const pool: number[] = [];
  for (const item of series) {
    const value = totalAt(item, index);
    if (value !== null) pool.push(value);
  }
  return pool.sort((left, right) => left - right);
}

export function boundariesOf(
  pool: readonly number[],
): readonly number[] | null {
  if (pool.length < MIN_TIER_POOL) return null;
  return BAND_PERCENTILES.map((ratio) => quantile(pool, ratio) ?? 0);
}

export function bandOf(value: number, boundaries: readonly number[]): number {
  return boundaries.filter((edge) => value >= edge).length;
}

export function insightsModeFor(cohortSize: number): InsightsMode {
  if (cohortSize >= MIN_TIER_POOL) return 'tier';
  return cohortSize >= ENVELOPE_MIN_POOL ? 'envelope' : 'solo';
}

export interface GrowthDomain {
  readonly top: number;
  readonly ticks: readonly number[];
}

function spanOf(top: number, step: number): GrowthDomain {
  return {
    top,
    ticks: Array.from(
      { length: Math.round(top / step) + 1 },
      (_unused, index) => index * step,
    ),
  };
}

export function growthDomain(peak: number): GrowthDomain {
  const padded = Math.max(peak, 1) * DOMAIN_HEADROOM;
  for (let exponent = 0; exponent <= MAX_STEP_EXPONENT; exponent += 1) {
    for (const factor of STEP_FACTORS) {
      const step = factor * 10 ** exponent;
      if (!Number.isInteger(step)) continue;
      const spans = Math.ceil(padded / step);
      if (spans > MAX_TICK_SPANS) continue;
      return spanOf(step * spans, step);
    }
  }
  return spanOf(Math.ceil(padded), 1);
}

export function bandCrossings(
  totals: readonly (number | null)[],
  boundaries: readonly (readonly number[] | null)[],
): BandCrossing[] {
  const crossings: BandCrossing[] = [];
  const earned = new Set<number>();
  let previous: number | null = null;
  for (const [index, value] of totals.entries()) {
    const edges = boundaries[index] ?? null;
    if (value === null || edges === null) continue;
    const band = bandOf(value, edges);
    if (previous === null) {
      for (let entry = 0; entry <= band; entry += 1) earned.add(entry);
      previous = band;
      continue;
    }
    for (let entry = previous + 1; entry <= band; entry += 1) {
      if (earned.has(entry)) continue;
      crossings.push({ band: entry, pointIndex: index });
      earned.add(entry);
    }
    previous = band;
  }
  return crossings;
}

export function growthEndLabel(
  ranks: readonly (number | null)[],
): GrowthEndLabel | null {
  const last = ranks[ranks.length - 1] ?? null;
  if (last === null) return null;
  const previous = ranks.length < 2 ? null : (ranks[ranks.length - 2] ?? null);
  return { rank: last, delta: previous === null ? null : previous - last };
}

export function endLabelDelta(delta: number | null): string {
  if (delta === null) return 'NEW';
  if (delta > 0) return `▲${String(delta)}`;
  if (delta < 0) return `▼${String(-delta)}`;
  return '–';
}

export function debutIndexOf(
  totals: readonly (number | null)[],
): number | null {
  const first = totals.findIndex((value) => value !== null);
  return first > 0 ? first : null;
}

function growthPoints(
  points: readonly RankingTimelinePoint[],
  crowd: readonly RankingTimelineSeries[],
): GrowthPoint[] {
  return points.map((point, index) => {
    const pool = poolAt(crowd, index);
    return {
      label: pointLabel(point),
      month: monthLabel(point),
      starEstimated: point.starEstimated,
      boundaries: boundariesOf(pool),
      median: quantile(pool, 0.5),
      low: pool[0] ?? null,
      high: pool[pool.length - 1] ?? null,
      poolSize: pool.length,
    };
  });
}

function peakOf(
  mode: InsightsMode,
  points: readonly GrowthPoint[],
  viewerTotals: readonly (number | null)[],
): number {
  let peak = 0;
  for (const point of points) {
    const crowd =
      mode === 'tier' ? (point.boundaries?.[3] ?? null) : point.high;
    if (crowd !== null) peak = Math.max(peak, crowd);
  }
  for (const value of viewerTotals) {
    if (value !== null) peak = Math.max(peak, value);
  }
  return peak;
}

export function buildGrowthInsights(timeline: RankingTimeline): GrowthInsights {
  const { points } = timeline;
  const split = splitSeries(timeline);
  const derived = growthPoints(points, split.crowd);
  const cohortSize = derived.reduce(
    (widest, point) => Math.max(widest, point.poolSize),
    0,
  );
  const mode = insightsModeFor(cohortSize);
  const totals = split.viewer?.totals;
  let viewer: GrowthViewer | null = null;
  if (split.viewer !== null && totals !== undefined) {
    const boundaries = derived.map((point) => point.boundaries);
    const activity = monthlyActivity(totals);
    viewer = {
      login: split.viewer.githubLogin,
      totals,
      activity,
      bands: totals.map((value, index) => {
        const edges = boundaries[index] ?? null;
        return value === null || edges === null ? null : bandOf(value, edges);
      }),
      crossings: mode === 'tier' ? bandCrossings(totals, boundaries) : [],
      endLabel: growthEndLabel(split.viewer.ranks),
      thisMonth: activity[activity.length - 1] ?? null,
      debutIndex: debutIndexOf(totals),
      silent: split.viewerSilent,
    };
  }
  const lastIndex = points.length - 1;
  const fresh =
    viewer === null
      ? null
      : (viewer.crossings
          .filter((crossing) => crossing.pointIndex === lastIndex)
          .at(-1) ?? null);
  const domain = growthDomain(peakOf(mode, derived, viewer?.totals ?? []));
  return {
    mode,
    cohortSize,
    points: derived,
    viewer,
    domainTop: domain.top,
    ticks: domain.ticks,
    freshCrossing: fresh,
    summited:
      viewer?.crossings.some((crossing) => crossing.band === SUMMIT_BAND) ??
      false,
    estimated: points.some((point) => point.starEstimated),
  };
}

function competitionRanks(racers: readonly MonthRacer[]): MonthRacer[] {
  const ranked: MonthRacer[] = [];
  let rank = 1;
  for (const [index, racer] of racers.entries()) {
    const previous = racers[index - 1];
    if (previous !== undefined && previous.score !== racer.score) {
      rank = index + 1;
    }
    ranked.push({ ...racer, rank });
  }
  return ranked;
}

function podiumOf(racers: readonly MonthRacer[]): PodiumBox[] {
  const boxes: PodiumBox[] = [];
  for (const rank of PODIUM_RANKS) {
    const members = racers.filter(
      (racer) => racer.rank === rank && racer.score >= 1,
    );
    if (members.length > 0) boxes.push({ rank, members });
  }
  return boxes;
}

function standingsOf(
  racers: readonly MonthRacer[],
  podiumCount: number,
): StandingsEntry[] {
  const viewerPosition = racers.findIndex((racer) => racer.isViewer);
  const start =
    viewerPosition === -1 || viewerPosition < podiumCount + STANDINGS_WINDOW
      ? podiumCount
      : viewerPosition - 1;
  const end = Math.min(racers.length - 1, start + STANDINGS_WINDOW - 1);
  const entries: StandingsEntry[] = [];
  const leading = start - podiumCount;
  if (leading > 0) entries.push({ kind: 'gap', count: leading });
  for (const racer of racers.slice(start, end + 1)) {
    entries.push({ kind: 'row', racer });
  }
  const trailing = Math.max(0, racers.length - 1 - end);
  if (trailing > 0 && entries.length > 0) {
    entries.push({ kind: 'gap', count: trailing });
  }
  return entries;
}

function nudgeOf(
  racers: readonly MonthRacer[],
  viewer: MonthRacer | null,
): MonthNudge | null {
  if (viewer === null) return null;
  if (viewer.score === 0) return { kind: 'start', rank: viewer.rank };
  let next: number | null = null;
  let best: number | null = null;
  for (const racer of racers) {
    if (racer.isViewer) continue;
    if (best === null || racer.score > best) best = racer.score;
    if (racer.score <= viewer.score) continue;
    if (next === null || racer.score < next) next = racer.score;
  }
  if (next === null) {
    return { kind: 'lead', gap: best === null ? null : viewer.score - best };
  }
  const holders = racers.filter((racer) => racer.score === next);
  const rival = holders[holders.length - 1];
  return {
    kind: 'climb',
    gap: next - viewer.score,
    next: rival === undefined ? '' : rival.login,
  };
}

function rhythmOf(
  points: readonly RankingTimelinePoint[],
  activity: readonly (number | null)[],
): Rhythm {
  const values = activity.filter((value): value is number => value !== null);
  const max = values.reduce((widest, value) => Math.max(widest, value), 0);
  const lastIndex = activity.length - 1;
  const bars = points.map((point, index) => {
    const value = activity[index] ?? null;
    return {
      index,
      month: monthLabel(point),
      value,
      isMax: max > 0 && value === max,
      isCurrent: index === lastIndex,
    };
  });
  const peak = bars.find((bar) => bar.isMax) ?? null;
  const current = activity[lastIndex] ?? null;
  const seen = activity
    .slice(0, lastIndex)
    .filter((value): value is number => value !== null);
  const previous = lastIndex < 1 ? null : (activity[lastIndex - 1] ?? null);
  const record = seen.reduce((widest, value) => Math.max(widest, value), 0);
  return {
    bars,
    max,
    maxMonth: peak === null ? null : peak.month,
    tiedMax: bars.filter((bar) => bar.isMax).length > 1,
    empty: max === 0,
    personalBest:
      current !== null &&
      current >= 1 &&
      current > record &&
      seen.length >= PERSONAL_BEST_HISTORY,
    comeback: previous === 0 && current !== null && current >= 1,
  };
}

function raceSummary(
  month: string,
  viewer: MonthRacer | null,
  nudge: MonthNudge | null,
): string {
  if (viewer === null) return `${month} 레이스 집계`;
  const head = `${month} 레이스: 나는 +${String(viewer.score)}점으로 ${String(viewer.rank)}위`;
  if (nudge === null || nudge.kind === 'start') return `${head}.`;
  if (nudge.kind === 'lead') {
    return nudge.gap === null || nudge.gap === 0
      ? `${head}, 공동 선두.`
      : `${head}, 2위와 ${String(nudge.gap)}점 차.`;
  }
  return `${head}, 한 칸 위까지 ${String(nudge.gap)}점.`;
}

function racerOf(
  item: RankingTimelineSeries,
  lastIndex: number,
  viewerLogin: string | null,
): MonthRacer | null {
  const total = totalAt(item, lastIndex);
  if (total === null) return null;
  const previous = lastIndex === 0 ? null : totalAt(item, lastIndex - 1);
  return {
    login: item.githubLogin,
    score: previous === null ? total : Math.max(0, total - previous),
    rank: 1,
    total,
    isViewer: item.githubLogin === viewerLogin,
    isDebut: lastIndex > 0 && previous === null,
  };
}

export function buildMonthRace(timeline: RankingTimeline): MonthRace | null {
  const { points } = timeline;
  const lastIndex = points.length - 1;
  const live = points[lastIndex];
  if (live === undefined) return null;
  const split = splitSeries(timeline);
  const viewerLogin = split.viewer?.githubLogin ?? null;
  const entered: MonthRacer[] = [];
  let pendingCount = 0;
  for (const item of split.crowd) {
    const racer = racerOf(item, lastIndex, viewerLogin);
    if (racer === null) pendingCount += 1;
    else entered.push(racer);
  }
  if (split.viewer !== null && split.viewerSilent) {
    const racer = racerOf(split.viewer, lastIndex, viewerLogin);
    if (racer !== null) entered.push(racer);
  }
  const racers = competitionRanks(
    entered.sort(
      (left, right) =>
        right.score - left.score ||
        right.total - left.total ||
        compareLogin(left.login, right.login),
    ),
  );
  const viewer = racers.find((racer) => racer.isViewer) ?? null;
  const podium = podiumOf(racers);
  const podiumCount = podium.reduce(
    (count, box) => count + box.members.length,
    0,
  );
  const startline =
    racers.length > 0 && racers.every((racer) => racer.score === 0);
  const standings = startline ? [] : standingsOf(racers, podiumCount);
  const nudge = nudgeOf(racers, viewer);
  const rhythm =
    viewer === null || split.viewer === null
      ? null
      : rhythmOf(points, monthlyActivity(split.viewer.totals ?? []));
  const shown = startline
    ? racers
    : [
        ...podium.flatMap((box) => box.members),
        ...standings.flatMap((entry) =>
          entry.kind === 'row' ? [entry.racer] : [],
        ),
      ];
  const debutShown = shown.some((racer) => racer.isDebut);
  const previousPoint = points[lastIndex - 1];
  const deltaEstimated =
    live.starEstimated || (previousPoint?.starEstimated ?? false);
  return {
    month: monthLabel(live),
    day: live.date.slice(8, 10).replace(/^0/u, ''),
    racers,
    podium,
    standings,
    nudge,
    viewer,
    rhythm,
    startline,
    zeroCount: racers.filter((racer) => racer.score === 0).length,
    pendingCount,
    debutShown,
    estimated: debutShown
      ? points.some((point) => point.starEstimated)
      : deltaEstimated,
    summary: raceSummary(monthLabel(live), viewer, nudge),
  };
}

export interface ChartTabPlan {
  readonly tabs: readonly RankingChartTab[];
  readonly active: RankingChartTab;
}

export function chartTabPlan(timeline: RankingTimeline): ChartTabPlan {
  if (
    timeline.viewerClass === RANKING_VIEWER_CLASSES.PUBLIC ||
    timeline.points.length === 0 ||
    !hasTotals(timeline.series)
  ) {
    return { tabs: [], active: 'race' };
  }
  const split = splitSeries(timeline);
  if (split.viewer === null && split.crowd.length === 0) {
    return { tabs: [], active: 'race' };
  }
  return {
    tabs: RANKING_CHART_TABS,
    active: split.viewer === null ? 'month' : 'growth',
  };
}
