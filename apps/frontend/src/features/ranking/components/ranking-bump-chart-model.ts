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
const BUBBLE_PAD = 24;
const BUBBLE_SIDE_PAD = 16;
const BUBBLE_ROW_HEIGHT = 20;
const BUBBLE_BASE_HEIGHT = 20;
const BUBBLE_GAP = 12;
const BUBBLE_TAIL_DROP = 14;
const BUBBLE_LIFT = 2;
const BUBBLE_RIGHT_EDGE = 160;
const BUBBLE_OVERFLOW_ALLOWANCE = 48;
const NOTE_REACH = 28;
const NOTE_SWIPE_REACH = 34;
const NOTE_BOX_PAD = 4;
const NOTE_BOX_RISE = 14;
const NOTE_BOX_HEIGHT = 20;

type BumpRow = Record<string, string | number | null>;

export interface Pointer {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlotBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface NotePlacement {
  readonly label: string;
  readonly anchor: Pointer;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly below: boolean;
  readonly flipLeft: boolean;
  readonly swipe: boolean;
}

export interface HoverBubble {
  readonly headline: string;
  readonly total: number | null;
  readonly starEstimated: boolean;
  readonly below: boolean;
  readonly rect: Rect;
}

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

function totalAt(series: RankingTimelineSeries, index: number): number | null {
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

export function rankDomainMax(
  series: readonly RankingTimelineSeries[],
): number {
  let deepest = 0;
  for (const item of series) {
    for (const rank of item.ranks) {
      if (rank !== null && rank !== undefined && rank > deepest) {
        deepest = rank;
      }
    }
  }
  return Math.max(deepest, series.length, RANK_DOMAIN_FLOOR);
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

function nearestPointIndex(
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

function nearestSeriesOrder(
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

export function distance(from: Pointer, to: Pointer): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

export function rectsOverlap(one: Rect, other: Rect): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}

function bubbleBox(
  anchor: Pointer,
  plot: Rect,
  headline: string,
  rows: number,
): Rect & { readonly below: boolean } {
  const width = approxTextWidth(headline) + BUBBLE_PAD + BUBBLE_SIDE_PAD;
  const height = BUBBLE_BASE_HEIGHT + BUBBLE_ROW_HEIGHT * rows + BUBBLE_PAD;
  const below = anchor.y - height - BUBBLE_GAP < plot.y;
  const nearRight = anchor.x > plot.x + plot.width - BUBBLE_RIGHT_EDGE;
  const x = clamp(
    nearRight ? anchor.x - width - BUBBLE_GAP : anchor.x + BUBBLE_GAP,
    plot.x,
    Math.max(plot.x, plot.x + plot.width - width + BUBBLE_OVERFLOW_ALLOWANCE),
  );
  const y = below
    ? anchor.y + BUBBLE_TAIL_DROP
    : anchor.y - height - BUBBLE_LIFT;
  return { x, y, width, height, below };
}

export function hoverBubble(input: {
  readonly points: readonly RankingTimelinePoint[];
  readonly series: readonly RankingTimelineSeries[];
  readonly labels: readonly string[];
  readonly revealed: number;
  readonly pointer: Pointer | null;
  readonly plot: Rect;
  readonly xScale: (value: string) => number | undefined;
  readonly yScale: (rank: number) => number | undefined;
}): HoverBubble | null {
  const { points, series, labels, revealed, pointer, plot } = input;
  if (pointer === null) return null;
  const monthIndex = nearestPointIndex(
    labels.slice(0, revealed),
    pointer.x,
    input.xScale,
  );
  if (monthIndex === null) return null;
  const order = nearestSeriesOrder(series, monthIndex, pointer.y, input.yScale);
  if (order === null) return null;
  const item = series[order];
  const point = points[monthIndex];
  const label = labels[monthIndex];
  if (item === undefined || point === undefined || label === undefined) {
    return null;
  }
  const rank = rankAt(item, monthIndex);
  const x = input.xScale(label);
  const y = rank === null ? undefined : input.yScale(rank);
  if (rank === null || x === undefined || y === undefined) return null;
  const total = totalAt(item, monthIndex);
  const headline = `@${item.githubLogin} · ${monthLabel(point)} · ${String(rank)}위`;
  const { below, ...rect } = bubbleBox(
    { x, y },
    plot,
    headline,
    total === null ? 1 : 2,
  );
  return {
    headline,
    total,
    starEstimated: point.starEstimated,
    below,
    rect,
  };
}

export function notePlacement(input: {
  readonly label: string;
  readonly anchor: Pointer;
  readonly below: boolean;
  readonly flipLeft: boolean;
  readonly bounds: PlotBounds;
  readonly swipe: boolean;
}): NotePlacement {
  const { label, anchor, below, flipLeft, bounds, swipe } = input;
  const width = approxTextWidth(label);
  const reach = swipe ? NOTE_SWIPE_REACH : NOTE_REACH;
  const rawX = flipLeft ? anchor.x - reach - width : anchor.x + reach;
  const rawY = below ? anchor.y + reach + 4 : anchor.y - reach + 2;
  return {
    label,
    anchor,
    x: clamp(rawX, bounds.left + 4, bounds.right - width - 4),
    y: clamp(rawY, bounds.top + 14, bounds.bottom - 6),
    width,
    below,
    flipLeft,
    swipe,
  };
}

export function noteBox(placement: NotePlacement): Rect {
  return {
    x: placement.x - NOTE_BOX_PAD,
    y: placement.y - NOTE_BOX_RISE,
    width: placement.width + NOTE_BOX_PAD * 2,
    height: NOTE_BOX_HEIGHT,
  };
}
