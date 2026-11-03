import type {
  PublicRankingItem,
  RankingTimeline,
  RankingTimelineSeries,
} from '../types';

const LEGEND_LIMIT = 10;
const LEAD_LIMIT = 3;
const SERIES_COLORS = [25, 260, 145, 330, 200, 50, 290, 175, 0, 115].map(
  (hue) => `oklch(0.64 0.17 ${String(hue)})`,
);
const VIEWER_COLOR = 'var(--chart-3)';
const REST_COLOR =
  'color-mix(in oklch, var(--muted-foreground) 55%, var(--card))';
export const RANKING_HISTORY_COMPACT_LEGEND_LIMIT = 5;

const RANKING_HISTORY_STROKE = {
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
  readonly strokeWidth: number;
  readonly faded: boolean;
  readonly isViewer: boolean;
  readonly showDot: boolean;
  readonly tipIndex: number;
}

export interface RankingHistoryRow {
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

function rankingHistoryStrokeWidth(
  finalRank: number,
  isViewer: boolean,
): number {
  if (isViewer || finalRank <= LEAD_LIMIT) return RANKING_HISTORY_STROKE.lead;
  if (finalRank <= LEGEND_LIMIT) return RANKING_HISTORY_STROKE.legend;
  return RANKING_HISTORY_STROKE.rest;
}

export function buildRankingHistoryChart(
  timeline: RankingTimeline,
  viewerGithubLogin: string | null,
): RankingHistoryChart {
  const lines = timeline.series.map((series, order) =>
    lineOf(series, order, viewerGithubLogin),
  );
  const rows = timeline.months.map((month, index) => ({
    ...Object.fromEntries(
      lines.map((line) => [line.key, line.totals[index] ?? null]),
    ),
    label: `${String(month)}월`,
  }));
  const legend = lines
    .filter((line) => line.isViewer || line.finalRank <= LEGEND_LIMIT)
    .sort((left, right) => left.finalRank - right.finalRank);
  return { rows, lines: [...lines].sort(byPaintOrder), legend };
}

export function rankingHistoryLogRows(
  rows: readonly RankingHistoryRow[],
): readonly RankingHistoryRow[] {
  return rows.map((row) => ({
    ...Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.max(value, 1) : value,
      ]),
    ),
    label: row.label,
  }));
}

export function rankingHistoryLogTicks(
  lines: readonly RankingHistoryLine[],
): readonly number[] {
  const max = Math.max(1, ...lines.flatMap(lineTotalsOf));
  const ticks = [1];
  while ((ticks.at(-1) ?? 1) * 10 <= max) ticks.push((ticks.at(-1) ?? 1) * 10);
  return ticks;
}

function lineTotalsOf(line: RankingHistoryLine): readonly number[] {
  return line.totals.filter((total) => total !== null);
}

export function rankingRankChanges(
  items: readonly Pick<
    PublicRankingItem,
    'githubLogin' | 'rank' | 'previousRank'
  >[],
): ReadonlyMap<string, RankingRankChange> {
  return new Map(
    items.map(({ githubLogin, rank, previousRank }) => [
      githubLogin,
      changeOf(previousRank, rank),
    ]),
  );
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

function changeOf(previous: number | null, current: number): RankingRankChange {
  if (previous === null) return { kind: 'new' };
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
  return {
    key: `s${String(order)}`,
    githubLogin: series.githubLogin,
    finalRank,
    totals: series.totals,
    ranks: series.ranks,
    color: colorOf(finalRank, isViewer, ranked),
    strokeWidth: rankingHistoryStrokeWidth(finalRank, isViewer),
    faded: !isViewer && !ranked,
    isViewer,
    showDot:
      isViewer || series.totals.filter((total) => total !== null).length === 1,
    tipIndex: series.totals.findLastIndex((total) => total !== null),
  };
}

function colorOf(
  finalRank: number,
  isViewer: boolean,
  ranked: boolean,
): string {
  if (isViewer) return VIEWER_COLOR;
  if (!ranked) return REST_COLOR;
  return SERIES_COLORS[finalRank - 1] ?? REST_COLOR;
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

export function rankingHistoryAvatarSlots(
  tips: readonly number[],
  gap: number,
  top: number,
  bottom: number,
): readonly number[] {
  const order = tips
    .map((_tip, index) => index)
    .sort((a, b) => (tips[a] ?? 0) - (tips[b] ?? 0));
  const step = Math.min(gap, (bottom - top) / Math.max(1, order.length - 1));
  const slots = order.map((index) => tips[index] ?? 0);
  for (let i = 0; i < slots.length; i += 1) {
    slots[i] = Math.max(
      slots[i] ?? 0,
      top,
      i === 0 ? top : (slots[i - 1] ?? 0) + step,
    );
  }
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    slots[i] = Math.min(
      slots[i] ?? 0,
      bottom,
      i === slots.length - 1 ? bottom : (slots[i + 1] ?? 0) - step,
    );
  }
  const placed = new Array<number>(tips.length);
  order.forEach((index, rank) => {
    placed[index] = slots[rank] ?? 0;
  });
  return placed;
}
