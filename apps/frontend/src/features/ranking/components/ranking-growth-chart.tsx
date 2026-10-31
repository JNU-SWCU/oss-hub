'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from 'react';
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  ZIndexLayer,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { RankingTimeline } from '../types';
import { approxTextWidth, clamp, type Rect } from './ranking-bump-chart-model';
import {
  BAND_TIERS,
  endLabelDelta,
  pennantMarks,
  SUMMIT_BAND,
  tierTags,
  type GrowthInsights,
  type GrowthPoint,
  type TierTag,
} from './ranking-insights-model';
import styles from './ranking-insights.module.css';

const BAND_FILLS = [
  'color-mix(in oklch, var(--chart-5) 10%, transparent)',
  'color-mix(in oklch, var(--chart-2) 14%, transparent)',
  'color-mix(in oklch, var(--chart-4) 18%, transparent)',
  'color-mix(in oklch, var(--chart-1) 14%, transparent)',
  'color-mix(in oklch, var(--chart-3) 8%, transparent)',
];
const BAND_INKS = [
  'var(--chart-5)',
  'var(--chart-2)',
  'var(--chart-4)',
  'var(--chart-1)',
  'var(--chart-3)',
];
const ENVELOPE_FILL = 'color-mix(in oklch, var(--chart-2) 10%, transparent)';
const HIGHLIGHTER = 'color-mix(in oklch, var(--chart-3) 30%, transparent)';
const VIEWER_COLOR = 'var(--chart-1)';
const BOLD_FILTER = 'url(#growth-sketch-bold)';
const FINE_FILTER = 'url(#growth-sketch-fine)';

const CHART_MARGIN = { top: 30, bottom: 8, left: 8 };
const Y_AXIS_WIDTH = 56;
const X_AXIS_HEIGHT = 34;
const X_TICK_DROP = 10;
const MIN_GUTTER = 96;
const MAX_GUTTER = 168;
const NARROW_GUTTER = 58;
const NARROW_QUERY = '(max-width: 639px)';
const GUTTER_PAD = 18;
const LABEL_LINE = 15;
const DOT_RADIUS = 4;
const RIDGE_KEY = 'p90';
const END_LABEL_INSET = 8;
const BUBBLE_HEIGHT = 34;
const BUBBLE_GAP = 14;
const BUBBLE_FLIP_PAD = 56;
const BUBBLE_PAD = 26;
const PENNANT_POLE = 14;
const AREA_Z = 100;
const BOUNDARY_Z = 200;
const MEDIAN_Z = 210;
const UNDERLAY_Z = 300;
const VIEWER_Z = 320;
const LABEL_Z = 900;
const BUBBLE_Z = 1000;

interface GrowthRow {
  readonly label: string;
  readonly band0: readonly [number, number] | null;
  readonly band1: readonly [number, number] | null;
  readonly band2: readonly [number, number] | null;
  readonly band3: readonly [number, number] | null;
  readonly band4: readonly [number, number] | null;
  readonly envelope: readonly [number, number] | null;
  readonly median: number | null;
  readonly viewer: number | null;
  readonly p25: number | null;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
}

const BOUNDARY_KEYS = ['p25', 'p50', 'p75', 'p90'] as const;

function bandSpan(
  point: GrowthPoint,
  band: number,
  domainTop: number,
): readonly [number, number] | null {
  const edges = point.boundaries;
  if (edges === null) return null;
  const low = band === 0 ? 0 : (edges[band - 1] ?? 0);
  const high = band === BAND_TIERS.length - 1 ? domainTop : (edges[band] ?? 0);
  return [low, high];
}

function buildRows(insights: GrowthInsights): GrowthRow[] {
  const { points, viewer, domainTop, mode } = insights;
  return points.map((point, index) => {
    const tiered = mode === 'tier';
    const enveloped =
      mode === 'envelope' &&
      point.low !== null &&
      point.high !== null &&
      point.poolSize >= 2;
    return {
      label: point.label,
      band0: tiered ? bandSpan(point, 0, domainTop) : null,
      band1: tiered ? bandSpan(point, 1, domainTop) : null,
      band2: tiered ? bandSpan(point, 2, domainTop) : null,
      band3: tiered ? bandSpan(point, 3, domainTop) : null,
      band4: tiered ? bandSpan(point, 4, domainTop) : null,
      envelope:
        enveloped && point.low !== null && point.high !== null
          ? [point.low, point.high]
          : null,
      median: point.median,
      viewer: viewer === null ? null : (viewer.totals[index] ?? null),
      p25: tiered ? (point.boundaries?.[0] ?? null) : null,
      p50: tiered ? (point.boundaries?.[1] ?? null) : null,
      p75: tiered ? (point.boundaries?.[2] ?? null) : null,
      p90: tiered ? (point.boundaries?.[3] ?? null) : null,
    };
  });
}

function GrowthDefs() {
  return (
    <defs>
      <filter
        id="growth-sketch-bold"
        filterUnits="userSpaceOnUse"
        x={-40}
        y={-40}
        width={1400}
        height={760}
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.022"
          numOctaves={2}
          seed={11}
          result="growthBold"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="growthBold"
          scale={6}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter
        id="growth-sketch-fine"
        filterUnits="userSpaceOnUse"
        x={-40}
        y={-40}
        width={1400}
        height={760}
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.04"
          numOctaves={2}
          seed={13}
          result="growthFine"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="growthFine"
          scale={3}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  );
}

function useGeometry() {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (plot === undefined || xScale === undefined || yScale === undefined) {
    return null;
  }
  return { plot, xScale, yScale };
}

function BandLabels({ tags }: { readonly tags: readonly TierTag[] }) {
  return (
    <g>
      {tags.map((tag) => (
        <text
          key={`tag-${String(tag.band)}`}
          className={styles.tierTag}
          x={tag.x}
          y={tag.y}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {tag.text}
        </text>
      ))}
    </g>
  );
}

function viewerEndY(
  insights: GrowthInsights,
  yScale: (value: number) => number | undefined,
): number | null {
  const totals = insights.viewer?.totals ?? [];
  for (let index = totals.length - 1; index >= 0; index -= 1) {
    const value = totals[index] ?? null;
    if (value !== null) return yScale(value) ?? null;
  }
  return null;
}

function GrowthLabelLayer({
  insights,
  gutter,
  narrow,
}: {
  readonly insights: GrowthInsights;
  readonly gutter: number;
  readonly narrow: boolean;
}) {
  const geometry = useGeometry();
  if (geometry === null) return null;
  const { plot, yScale } = geometry;
  const edges = insights.points.at(-1)?.boundaries ?? null;
  const tags =
    edges === null
      ? []
      : tierTags({
          edges,
          domainTop: insights.domainTop,
          plot,
          yOf: (value) => yScale(value),
          viewerY: viewerEndY(insights, (value) => yScale(value)),
        });
  return (
    <g>
      <BandLabels tags={tags} />
      <ViewerMarks
        insights={insights}
        gutter={gutter}
        narrow={narrow}
        obstacles={narrow ? [] : tags.map((tag) => tag.box)}
      />
    </g>
  );
}

function isNarrowViewport(): boolean {
  return typeof window === 'undefined'
    ? false
    : window.matchMedia(NARROW_QUERY).matches;
}

function ViewerMarks({
  insights,
  gutter,
  narrow,
  obstacles,
}: {
  readonly insights: GrowthInsights;
  readonly gutter: number;
  readonly narrow: boolean;
  readonly obstacles: readonly Rect[];
}) {
  const geometry = useGeometry();
  const viewer = insights.viewer;
  if (geometry === null || viewer === null) return null;
  const { plot, xScale, yScale } = geometry;
  const spotOf = (index: number) => {
    const label = insights.points[index]?.label;
    const value = viewer.totals[index] ?? null;
    if (label === undefined || value === null) return null;
    const x = xScale(label);
    const y = yScale(value);
    return x === undefined || y === undefined ? null : { x, y };
  };
  const lastIndex = insights.points.length - 1;
  const endSpot = spotOf(lastIndex);
  const debut = viewer.debutIndex === null ? null : spotOf(viewer.debutIndex);
  const label = viewer.endLabel;
  const marks = pennantMarks({
    crossings: viewer.crossings,
    spotOf,
    plot,
    obstacles,
  });
  return (
    <g>
      {debut === null ? null : (
        <g className={styles.debut} filter={FINE_FILTER}>
          <rect x={debut.x - 6} y={debut.y - 6} width={12} height={12} />
          <rect
            x={debut.x - 6}
            y={debut.y - 6}
            width={12}
            height={12}
            transform={`rotate(45 ${String(debut.x)} ${String(debut.y)})`}
          />
          <text
            className={styles.debutLabel}
            x={debut.x}
            y={debut.y - 14}
            textAnchor="middle"
          >
            신입!
          </text>
        </g>
      )}
      <g className={styles.handDots} filter={FINE_FILTER}>
        {insights.points.map((point, index) => {
          const spot = spotOf(index);
          return spot === null ? null : (
            <circle
              key={`dot-${point.label}`}
              cx={spot.x}
              cy={spot.y}
              r={DOT_RADIUS}
              stroke={VIEWER_COLOR}
            />
          );
        })}
      </g>
      {marks.map((mark) => (
        <g
          key={`sticker-${String(mark.crossing.band)}-${String(mark.crossing.pointIndex)}`}
          data-band-crossing={`${String(mark.crossing.band)}:${String(mark.crossing.pointIndex)}`}
          transform={`translate(${String(mark.spot.x)}, ${String(mark.spot.y)})`}
        >
          <g
            {...(mark.crossing === insights.freshCrossing
              ? { 'data-fresh': '' }
              : {})}
            className={styles.pennant}
          >
            <path
              className={styles.pennantPole}
              d={`M0 0 V-${String(PENNANT_POLE)}`}
            />
            <path
              className={styles.pennantFlag}
              d="M0 -14 L10 -11 L0 -8 Z"
              fill={BAND_INKS[mark.crossing.band]}
            />
            {mark.crossing.band === SUMMIT_BAND ? (
              <path
                className={styles.pennantFlag}
                d="M0 -20 L10 -17 L0 -14 Z"
                fill={BAND_INKS[mark.crossing.band]}
              />
            ) : null}
            <text
              className={styles.pennantLabel}
              x={mark.x}
              y={mark.y}
              textAnchor={mark.textAnchor}
            >
              {mark.text}
            </text>
          </g>
        </g>
      ))}
      {label === null || endSpot === null ? null : (
        <text
          data-growth-endlabel=""
          className={styles.endLabel}
          x={plot.x + plot.width + END_LABEL_INSET}
          y={clamp(
            endSpot.y,
            plot.y + LABEL_LINE,
            plot.y + plot.height - LABEL_LINE,
          )}
          filter={FINE_FILTER}
        >
          {narrow ? null : (
            <tspan
              x={plot.x + plot.width + END_LABEL_INSET}
              className={styles.endLabelLogin}
            >
              {fitLogin(viewer.login, gutter)}
            </tspan>
          )}
          <tspan
            x={plot.x + plot.width + END_LABEL_INSET}
            dy={narrow ? 0 : LABEL_LINE}
            className={styles.endLabelRank}
          >
            {`${String(label.rank)}위 ${endLabelDelta(label.delta)}`}
          </tspan>
        </text>
      )}
    </g>
  );
}

function fitLogin(login: string, gutter: number): string {
  const full = `@${login}`;
  const room = gutter - GUTTER_PAD;
  if (approxTextWidth(full) <= room) return full;
  let cut = full;
  while (cut.length > 3 && approxTextWidth(`${cut}…`) > room) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function thisMonthText(insights: GrowthInsights): string | null {
  const viewer = insights.viewer;
  if (viewer === null) return null;
  const score = viewer.thisMonth;
  if (score === null) return null;
  if (score === 0) return '이번 달 아직 0점 — 커밋 하나면 선이 다시 올라가요';
  const live = insights.points[insights.points.length - 1];
  return `이번 달 +${String(score)}점${live?.starEstimated === true ? '*' : ''}`;
}

function bubbleTextOf(insights: GrowthInsights, index: number): string | null {
  const viewer = insights.viewer;
  if (viewer === null) return null;
  const point = insights.points[index];
  const total = viewer.totals[index] ?? null;
  if (point === undefined || total === null) return null;
  const band = viewer.bands[index] ?? null;
  const tier = band === null ? null : BAND_TIERS[band];
  const star = point.starEstimated ? '*' : '';
  const where = tier === null ? '' : ` · ${tier.name} (${tier.range})`;
  return `${point.month} · 합계 ${String(total)}${star}점${where}`;
}

function GrowthBubble({
  insights,
  pointer,
}: {
  readonly insights: GrowthInsights;
  readonly pointer: number | null;
}) {
  const geometry = useGeometry();
  const viewer = insights.viewer;
  if (geometry === null || viewer === null) return null;
  const { plot, xScale, yScale } = geometry;
  const lastIndex = insights.points.length - 1;
  let index = lastIndex;
  if (pointer !== null) {
    let best = Number.POSITIVE_INFINITY;
    for (const [candidate, point] of insights.points.entries()) {
      if ((viewer.totals[candidate] ?? null) === null) continue;
      const at = xScale(point.label);
      if (at === undefined) continue;
      const gap = Math.abs(at - pointer);
      if (gap < best) {
        best = gap;
        index = candidate;
      }
    }
  }
  if (pointer === null) return null;
  const text = bubbleTextOf(insights, index);
  const label = insights.points[index]?.label;
  const total = viewer.totals[index] ?? null;
  if (text === null || label === undefined || total === null) return null;
  const x = xScale(label);
  const y = yScale(total);
  if (x === undefined || y === undefined) return null;
  const width = approxTextWidth(text) + BUBBLE_PAD;
  const below = y - BUBBLE_HEIGHT - BUBBLE_GAP < plot.y + BUBBLE_FLIP_PAD;
  const nearRight = x + width / 2 > plot.x + plot.width;
  return (
    <foreignObject
      x={clamp(
        nearRight ? x - width - BUBBLE_GAP : x - width / 2,
        plot.x,
        Math.max(plot.x, plot.x + plot.width - width),
      )}
      y={below ? y + BUBBLE_GAP : y - BUBBLE_HEIGHT - BUBBLE_GAP}
      width={width}
      height={BUBBLE_HEIGHT}
      pointerEvents="none"
    >
      <div className={cn(styles.bubble, below && styles.bubbleBelow)}>
        {text}
      </div>
    </foreignObject>
  );
}

function GrowthTable({ insights }: { readonly insights: GrowthInsights }) {
  const viewer = insights.viewer;
  return (
    <div className="sr-only">
      <table>
        <caption>월별 내 합계와 소속 구간</caption>
        <thead>
          <tr>
            <th scope="col">월</th>
            <th scope="col">내 합계</th>
            <th scope="col">월 활동</th>
            <th scope="col">소속 구간</th>
            <th scope="col">전체 중앙값</th>
          </tr>
        </thead>
        <tbody>
          {insights.points.map((point, index) => {
            const total = viewer?.totals[index] ?? null;
            const activity = viewer?.activity[index] ?? null;
            const band = viewer?.bands[index] ?? null;
            const tier = band === null ? null : BAND_TIERS[band];
            return (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{total === null ? '—' : `${String(total)}점`}</td>
                <td>{activity === null ? '—' : `+${String(activity)}점`}</td>
                <td>{tier === null ? '—' : `${tier.name} (${tier.range})`}</td>
                <td>
                  {point.median === null
                    ? '—'
                    : `${String(Math.round(point.median))}점`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function crowdNote(insights: GrowthInsights): string {
  if (insights.mode === 'solo') {
    return '아직 비교할 친구가 없어요 — 첫 등반 기록을 쌓는 중';
  }
  if (insights.mode === 'envelope') {
    return `참가 전원 범위 (${String(insights.cohortSize)}명)`;
  }
  return '구간은 그 달 집계된 참가자 합계의 백분위입니다. 구간 경계는 매달 다시 계산돼요.';
}

export function RankingGrowthChart({
  timeline,
  insights,
}: {
  readonly timeline: RankingTimeline;
  readonly insights: GrowthInsights;
}) {
  const [pointer, setPointer] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(isNarrowViewport);
  const rows = useMemo(() => buildRows(insights), [insights]);
  const viewer = insights.viewer;
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setNarrow(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);
  const gutter = useMemo(
    () =>
      narrow || viewer === null
        ? NARROW_GUTTER
        : clamp(
            Math.round(approxTextWidth(`@${viewer.login}`)) + GUTTER_PAD,
            MIN_GUTTER,
            MAX_GUTTER,
          ),
    [narrow, viewer],
  );
  const margin = useMemo(() => ({ ...CHART_MARGIN, right: gutter }), [gutter]);
  const onMove = useCallback(
    (_state: unknown, event: MouseEvent<SVGElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      setPointer(event.clientX - box.left);
    },
    [],
  );
  const onLeave = useCallback(() => {
    setPointer(null);
  }, []);

  const fresh = insights.freshCrossing;
  const freshTier = fresh === null ? null : BAND_TIERS[fresh.band];
  const celebration =
    freshTier === null
      ? null
      : `${freshTier.name} 진입! ${freshTier.range} 안이에요`;

  const thisMonth = viewer?.thisMonth ?? null;
  const monthScore = thisMonthText(insights);

  return (
    <div
      className={styles.panelBody}
      {...(thisMonth === null ? {} : { 'data-this-month': thisMonth })}
    >
      <div className={styles.panelHeader}>
        <p className={styles.panelTitle}>
          <em className={styles.hl}>{timeline.year}</em> 내 등반 지도
        </p>
        <p className={styles.panelLede}>
          {viewer === null
            ? '참가자로 로그인하면 내 선이 여기에 그려져요'
            : '쌓인 점수는 내려가지 않아요 — 위로, 오른쪽으로'}
        </p>
      </div>
      {monthScore === null ? null : (
        <p
          aria-live="polite"
          className={cn(
            styles.scoreChip,
            thisMonth === 0 && styles.scoreChipQuiet,
          )}
        >
          {monthScore}
        </p>
      )}
      {celebration === null ? null : (
        <p aria-live="polite" className={styles.celebration}>
          <span aria-hidden="true" className={styles.celebrationMark}>
            ✦
          </span>
          {celebration}
        </p>
      )}
      <div aria-hidden="true" className={styles.growthPlot}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={margin}
            accessibilityLayer={false}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          >
            <GrowthDefs />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              height={X_AXIS_HEIGHT}
              tick={{ dy: X_TICK_DROP }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              width={Y_AXIS_WIDTH}
              domain={[0, insights.domainTop]}
              ticks={[...insights.ticks]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => `${String(value)}점`}
            />
            {insights.mode === 'tier'
              ? BAND_TIERS.map((tier, band) => (
                  <Area
                    key={`band-${String(band)}`}
                    zIndex={AREA_Z + band}
                    data-band={band}
                    data-band-label={tier.name}
                    type="linear"
                    dataKey={`band${String(band)}`}
                    stroke="none"
                    fill={BAND_FILLS[band]}
                    fillOpacity={1}
                    connectNulls={false}
                    isAnimationActive={false}
                    activeDot={false}
                    dot={false}
                  />
                ))
              : null}
            {insights.mode === 'envelope' ? (
              <Area
                key="envelope"
                zIndex={AREA_Z}
                data-envelope=""
                type="linear"
                dataKey="envelope"
                stroke="none"
                fill={ENVELOPE_FILL}
                fillOpacity={1}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={false}
                dot={false}
              />
            ) : null}
            {insights.mode === 'tier'
              ? BOUNDARY_KEYS.map((key) => (
                  <Line
                    key={key}
                    zIndex={BOUNDARY_Z}
                    className={styles.boundary}
                    type="linear"
                    dataKey={key}
                    stroke={
                      key === RIDGE_KEY
                        ? 'var(--chart-3)'
                        : 'var(--muted-foreground)'
                    }
                    strokeWidth={key === RIDGE_KEY ? 2 : 1}
                    strokeDasharray={key === RIDGE_KEY ? '8 4' : '5 5'}
                    strokeOpacity={key === RIDGE_KEY ? 0.9 : 0.5}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))
              : null}
            {viewer === null && insights.mode !== 'solo' ? (
              <Line
                key="median"
                zIndex={MEDIAN_Z}
                className={styles.medianLine}
                type="linear"
                dataKey="median"
                stroke="var(--foreground)"
                strokeWidth={2}
                strokeDasharray="7 6"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : null}
            {viewer === null ? null : (
              <Line
                key="viewer-underlay"
                zIndex={UNDERLAY_Z}
                className={styles.underlay}
                type="monotone"
                dataKey="viewer"
                stroke={HIGHLIGHTER}
                strokeWidth={12}
                strokeLinecap="round"
                filter={BOLD_FILTER}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {viewer === null ? null : (
              <Line
                key="viewer-line"
                zIndex={VIEWER_Z}
                className={styles.viewerLine}
                type="monotone"
                dataKey="viewer"
                stroke={VIEWER_COLOR}
                strokeWidth={4}
                filter={BOLD_FILTER}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
                data-growth-viewer-line=""
              />
            )}
            <ZIndexLayer zIndex={LABEL_Z}>
              <GrowthLabelLayer
                insights={insights}
                gutter={gutter}
                narrow={narrow}
              />
            </ZIndexLayer>
            <ZIndexLayer zIndex={BUBBLE_Z}>
              <GrowthBubble insights={insights} pointer={pointer} />
            </ZIndexLayer>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p
        className={styles.panelNote}
        {...(insights.mode === 'solo' ? { 'data-solo': '' } : {})}
      >
        {crowdNote(insights)}
      </p>
      {viewer?.silent === true ? (
        <p className={styles.panelNote}>
          아직 올해 점수가 없어요 — 첫 커밋이 선의 시작점이에요.
        </p>
      ) : null}
      {viewer !== null && viewer.debutIndex !== null ? (
        <p className={styles.panelNote}>
          중간 합류자의 첫 달 점수에는 합류 이전 올해 활동이 포함될 수 있어요.
        </p>
      ) : null}
      {insights.estimated ? (
        <p data-star-estimated-note className={styles.panelNote}>
          * 표시된 달의 Star 수치는 추정값입니다.
        </p>
      ) : null}
      <GrowthTable insights={insights} />
    </div>
  );
}
