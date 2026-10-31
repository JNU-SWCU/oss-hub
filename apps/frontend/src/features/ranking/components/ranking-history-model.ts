import type { RankingTimeline, RankingTimelineSeries } from '../types';

const LEGEND_LIMIT = 10;
const LEAD_LIMIT = 3;
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-4)',
] as const;
const VIEWER_COLOR = 'var(--chart-3)';
const REST_COLOR =
  'color-mix(in oklch, var(--muted-foreground) 55%, var(--card))';
const DASH_PATTERNS = [undefined, '7 5', '2 4', '12 4 2 4'] as const;
const SWATCH_STYLES = ['solid', 'dashed', 'dotted', 'double'] as const;
export const RANKING_HISTORY_COMPACT_LEGEND_LIMIT = 5;

export const RANKING_HISTORY_STROKE = {
  lead: 2.8,
  legend: 1.8,
  rest: 0.9,
} as const;

export interface RankingHistoryLine {
  readonly key: string;
  readonly githubLogin: string;
  readonly finalRank: number;
  readonly totals: readonly (number | null)[];
  readonly ranks: readonly (number | null)[];
  readonly color: string;
  readonly dash: string | undefined;
  readonly swatchStyle: (typeof SWATCH_STYLES)[number];
  readonly strokeWidth: number;
  readonly faded: boolean;
  readonly isViewer: boolean;
}

interface RankingHistoryRow {
  readonly index: number;
  readonly label: string;
  readonly [seriesKey: string]: number | string | null;
}

export interface RankingHistoryChart {
  readonly rows: readonly RankingHistoryRow[];
  readonly lines: readonly RankingHistoryLine[];
  readonly legend: readonly RankingHistoryLine[];
}

export type RankingRankChange =
  | { readonly kind: 'up' | 'down'; readonly delta: number }
  | { readonly kind: 'same' | 'new' | 'unknown' };

export function rankingHistoryStrokeWidth(
  finalRank: number,
  isViewer: boolean,
): number {
  if (isViewer || finalRank <= LEAD_LIMIT) return RANKING_HISTORY_STROKE.lead;
  if (finalRank <= LEGEND_LIMIT) return RANKING_HISTORY_STROKE.legend;
  return RANKING_HISTORY_STROKE.rest;
}

export function rankingPointLabel(date: string): string {
  return `${String(Number(date.slice(5, 7)))}월`;
}

export function buildRankingHistoryChart(
  timeline: RankingTimeline,
): RankingHistoryChart {
  const lines = timeline.series.map((series, order) =>
    lineOf(series, order, timeline.viewerGithubLogin),
  );
  const rows = timeline.points.map((point, index) => ({
    ...Object.fromEntries(
      lines.map((line) => [line.key, line.totals[index] ?? null]),
    ),
    index,
    label: rankingPointLabel(point.date),
  }));
  const legend = lines
    .filter((line) => line.isViewer || line.finalRank <= LEGEND_LIMIT)
    .sort((left, right) => left.finalRank - right.finalRank);
  return { rows, lines: [...lines].sort(byPaintOrder), legend };
}

export function rankingRankChanges(
  timeline: RankingTimeline | null,
): ReadonlyMap<string, RankingRankChange> {
  const changes = new Map<string, RankingRankChange>();
  if (timeline === null || timeline.points.length < 2) return changes;
  for (const series of timeline.series) {
    changes.set(series.githubLogin, changeOf(series.ranks));
  }
  return changes;
}

export function formatRankChange(change: RankingRankChange): string {
  switch (change.kind) {
    case 'up':
      return `▲${String(change.delta)}`;
    case 'down':
      return `▼${String(change.delta)}`;
    case 'new':
      return 'NEW';
    case 'same':
      return '–';
    default:
      return '';
  }
}

function changeOf(ranks: readonly (number | null)[]): RankingRankChange {
  const current = ranks.at(-1);
  if (current === undefined || current === null) return { kind: 'unknown' };
  const previous = ranks.at(-2);
  if (previous === undefined || previous === null) return { kind: 'new' };
  if (previous === current) return { kind: 'same' };
  return previous > current
    ? { kind: 'up', delta: previous - current }
    : { kind: 'down', delta: current - previous };
}

function lineOf(
  series: RankingTimelineSeries,
  order: number,
  viewerGithubLogin: string | null,
): RankingHistoryLine {
  const finalRank = series.ranks.at(-1) ?? order + 1;
  const isViewer = series.githubLogin === viewerGithubLogin;
  const ranked = finalRank <= LEGEND_LIMIT;
  const style = isViewer || !ranked ? 0 : styleIndexOf(finalRank);
  return {
    key: `s${String(order)}`,
    githubLogin: series.githubLogin,
    finalRank,
    totals: series.totals,
    ranks: series.ranks,
    color: colorOf(finalRank, isViewer, ranked),
    dash: DASH_PATTERNS[style],
    swatchStyle: SWATCH_STYLES[style] ?? 'solid',
    strokeWidth: rankingHistoryStrokeWidth(finalRank, isViewer),
    faded: !isViewer && !ranked,
    isViewer,
  };
}

function styleIndexOf(finalRank: number): number {
  return Math.min(
    Math.floor(finalRank / SERIES_COLORS.length),
    DASH_PATTERNS.length - 1,
  );
}

function colorOf(
  finalRank: number,
  isViewer: boolean,
  ranked: boolean,
): string {
  if (isViewer) return VIEWER_COLOR;
  if (!ranked) return REST_COLOR;
  return SERIES_COLORS[(finalRank - 1) % SERIES_COLORS.length] ?? REST_COLOR;
}

function byPaintOrder(
  left: RankingHistoryLine,
  right: RankingHistoryLine,
): number {
  return (
    paintPriorityOf(left) - paintPriorityOf(right) ||
    right.finalRank - left.finalRank
  );
}

function paintPriorityOf(line: RankingHistoryLine): number {
  if (line.isViewer) return 2;
  return line.finalRank <= LEGEND_LIMIT ? 1 : 0;
}
