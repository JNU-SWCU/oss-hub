import type { RankingTimelinePoint, RankingTimelineSeries } from '../types';

export const PLAY_INTERVAL_MS = 700;

const COLORED_SERIES_LIMIT = 10;
const END_LABEL_LIMIT = 10;
const END_LABEL_GAP = 14;
const HOVER_SNAP_PX = 24;
const MIN_CLIMB = 2;
const RANK_TICK_STEPS = [1, 2, 5, 10, 25, 50];
const MAX_RANK_TICKS = 14;
const RANK_DOMAIN_FLOOR = 5;
const CROWD_OPACITY_BANDS = [
  { upTo: 50, opacity: 0.25 },
  { upTo: 150, opacity: 0.15 },
];
const CROWD_OPACITY_FLOOR = 0.1;
const LATIN_GLYPH_WIDTH = 6.2;
const WIDE_GLYPH_WIDTH = 13;
const ASCII_LIMIT = 128;

type BumpRow = Record<string, string | number | null>;

export interface SeriesPick {
  readonly order: number;
  readonly login: string;
  readonly rank: number;
}

interface EndLabelPlacement extends SeriesPick {
  readonly isViewer: boolean;
  readonly y: number;
}

interface ClimbPick extends SeriesPick {
  readonly climb: number;
}

export function seriesKey(order: number): string {
  return `s${order}`;
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

export function pointLabel(point: RankingTimelinePoint): string {
  return `${monthOf(point.date)}월${point.starEstimated ? '*' : ''}`;
}

export function monthLabel(point: RankingTimelinePoint): string {
  return `${monthOf(point.date)}월`;
}

export function rankAt(
  series: RankingTimelineSeries,
  index: number,
): number | null {
  return series.ranks[index] ?? null;
}

export function totalAt(
  series: RankingTimelineSeries,
  index: number,
): number | null {
  return series.totals === undefined ? null : (series.totals[index] ?? null);
}

export function buildRows(
  points: readonly RankingTimelinePoint[],
  series: readonly RankingTimelineSeries[],
  revealed: number,
): BumpRow[] {
  return points.map((point, index) => {
    const row: BumpRow = { label: pointLabel(point) };
    for (const [order, item] of series.entries()) {
      row[seriesKey(order)] = index < revealed ? rankAt(item, index) : null;
    }
    return row;
  });
}

export function rankDomainMax(seriesCount: number): number {
  return Math.max(seriesCount, RANK_DOMAIN_FLOOR);
}

export function rankTicks(domainMax: number): number[] {
  const step =
    RANK_TICK_STEPS.find(
      (candidate) => domainMax / candidate <= MAX_RANK_TICKS,
    ) ?? RANK_TICK_STEPS[RANK_TICK_STEPS.length - 1];
  const ticks = [1];
  for (let rank = step; rank <= domainMax; rank += step) {
    if (rank > 1) ticks.push(rank);
  }
  if (ticks[ticks.length - 1] !== domainMax) ticks.push(domainMax);
  return ticks;
}

export function isColoredMode(seriesCount: number): boolean {
  return seriesCount <= COLORED_SERIES_LIMIT;
}

export function crowdOpacity(seriesCount: number): number {
  return (
    CROWD_OPACITY_BANDS.find((band) => seriesCount <= band.upTo)?.opacity ??
    CROWD_OPACITY_FLOOR
  );
}

export function indexOfLogin(
  series: readonly RankingTimelineSeries[],
  login: string,
): number | null {
  const found = series.findIndex((item) => item.githubLogin === login);
  return found === -1 ? null : found;
}

function lastRankOf(series: RankingTimelineSeries, fallback: number): number {
  for (let index = series.ranks.length - 1; index >= 0; index -= 1) {
    const rank = series.ranks[index];
    if (rank !== null && rank !== undefined) return rank;
  }
  return fallback;
}

export function firstRankedIndex(series: RankingTimelineSeries): number | null {
  const found = series.ranks.findIndex(
    (rank) => rank !== null && rank !== undefined,
  );
  return found === -1 ? null : found;
}

export function isRookie(series: RankingTimelineSeries): boolean {
  const first = firstRankedIndex(series);
  return first !== null && first > 0;
}

export function leaderAt(
  series: readonly RankingTimelineSeries[],
  index: number,
): SeriesPick | null {
  for (const [order, item] of series.entries()) {
    if (rankAt(item, index) === 1) {
      return { order, login: item.githubLogin, rank: 1 };
    }
  }
  return null;
}

export function biggestClimb(
  series: readonly RankingTimelineSeries[],
  revealed: number,
): ClimbPick | null {
  if (revealed < 2) return null;
  const current = revealed - 1;
  const previous = revealed - 2;
  let best: ClimbPick | null = null;
  for (const [order, item] of series.entries()) {
    const now = rankAt(item, current);
    const before = rankAt(item, previous);
    if (now === null || before === null) continue;
    const climb = before - now;
    if (climb < MIN_CLIMB) continue;
    if (
      best === null ||
      climb > best.climb ||
      (climb === best.climb && now < best.rank)
    ) {
      best = { order, login: item.githubLogin, rank: now, climb };
    }
  }
  return best;
}

export function labelCandidates(
  series: readonly RankingTimelineSeries[],
  viewerOrder: number | null,
  limit: number = END_LABEL_LIMIT,
): SeriesPick[] {
  const picks: SeriesPick[] = series.slice(0, limit).map((item, order) => ({
    order,
    login: item.githubLogin,
    rank: lastRankOf(item, order + 1),
  }));
  if (viewerOrder === null) return picks;
  if (picks.some((pick) => pick.order === viewerOrder)) return picks;
  const viewer = series[viewerOrder];
  if (viewer === undefined) return picks;
  const trimmed = picks.slice(0, Math.max(0, limit - 1));
  trimmed.push({
    order: viewerOrder,
    login: viewer.githubLogin,
    rank: lastRankOf(viewer, viewerOrder + 1),
  });
  return trimmed.sort((left, right) => left.rank - right.rank);
}

export function stackLabels(
  picks: readonly SeriesPick[],
  viewerOrder: number | null,
  idealY: (rank: number) => number,
  plotBottom: number,
  gap: number = END_LABEL_GAP,
): EndLabelPlacement[] {
  const placements: EndLabelPlacement[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const pick of picks) {
    const y = Math.max(idealY(pick.rank), previous + gap);
    if (y > plotBottom) {
      if (pick.order !== viewerOrder) continue;
      const evicted = placements.pop();
      placements.push({
        ...pick,
        isViewer: true,
        y: evicted === undefined ? plotBottom : evicted.y,
      });
      break;
    }
    previous = y;
    placements.push({ ...pick, isViewer: pick.order === viewerOrder, y });
  }
  return placements;
}

export function nearestPointIndex(
  labels: readonly string[],
  pointerX: number,
  xScale: (value: string) => number | undefined,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, label] of labels.entries()) {
    const x = xScale(label);
    if (x === undefined) continue;
    const gap = Math.abs(x - pointerX);
    if (gap < bestDistance) {
      bestDistance = gap;
      best = index;
    }
  }
  return best;
}

export function nearestSeriesOrder(
  series: readonly RankingTimelineSeries[],
  pointIndex: number,
  pointerY: number,
  yScale: (rank: number) => number | undefined,
  snap: number = HOVER_SNAP_PX,
): number | null {
  let best: number | null = null;
  let bestDistance = snap;
  for (const [order, item] of series.entries()) {
    const rank = rankAt(item, pointIndex);
    if (rank === null) continue;
    const y = yScale(rank);
    if (y === undefined) continue;
    const gap = Math.abs(y - pointerY);
    if (gap <= bestDistance) {
      bestDistance = gap;
      best = order;
    }
  }
  return best;
}

export function approxTextWidth(text: string): number {
  let width = 0;
  for (const glyph of text) {
    width +=
      glyph.charCodeAt(0) < ASCII_LIMIT ? LATIN_GLYPH_WIDTH : WIDE_GLYPH_WIDTH;
  }
  return width;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function distance(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}
