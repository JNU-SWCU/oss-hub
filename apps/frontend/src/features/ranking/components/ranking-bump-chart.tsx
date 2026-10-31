'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  ZIndexLayer,
  usePlotArea,
  useXAxisScale,
  useXAxisTicks,
  useYAxisScale,
  useYAxisTicks,
} from 'recharts';
import { FilterChip, FilterChipGroup } from '@/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  RANKING_VIEWER_CLASSES,
  type RankingTimeline,
  type RankingTimelinePoint,
  type RankingTimelineSeries,
} from '../types';
import { comicNeue } from './comic-font';
import styles from './ranking-bump-chart.module.css';
import {
  approxTextWidth,
  biggestClimb,
  buildRows,
  clamp,
  crowdOpacity,
  distance,
  firstRankedIndex,
  hoverBubble,
  indexOfLogin,
  isColoredMode,
  isRookie,
  labelCandidates,
  leaderAt,
  monthLabel,
  noteBox,
  notePlacement,
  pointLabel,
  rankAt,
  rankDomainMax,
  rankTicks,
  rectsOverlap,
  seriesKey,
  stackLabels,
  PLAY_INTERVAL_MS,
  type HoverBubble,
  type NotePlacement,
  type Pointer,
  type SeriesPick,
} from './ranking-bump-chart-model';

const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
const VIEWER_COLOR = 'var(--chart-1)';
const PINNED_COLOR = 'var(--chart-2)';
const MUTED_COLOR = 'var(--muted-foreground)';
const HIGHLIGHTER = 'color-mix(in oklch, var(--chart-3) 30%, transparent)';

const BOLD_FILTER = 'url(#rank-sketch-bold)';
const FINE_FILTER = 'url(#rank-sketch-fine)';

const CHART_MARGIN = { top: 28, bottom: 8, left: 8 };
const Y_AXIS_WIDTH = 48;
const X_AXIS_HEIGHT = 38;
const X_TICK_DROP = 12;
const AXIS_DROP = 10;
const VIEWER_LABEL_EXTRA = 22;
const MIN_LABEL_GUTTER = 96;
const MAX_LABEL_GUTTER = 180;
const PLOT_MIN_HEIGHT = 320;
const PLOT_MAX_HEIGHT = 560;
const PLOT_HEIGHT_PER_SERIES = 6;
const PLOT_HEIGHT_BASE = 200;
const END_LABEL_OFFSET = 8;
const CROWN_PATH = 'M2 11 L1 4 L5 7 L9 1 L13 7 L17 4 L16 11 Z';
const CROWN_LIFT = 22;
const CROWN_HALF = 9;
const DOT_RADIUS = 4;
const ANNOTATION_COLLISION_PX = 48;
const NOTE_DIM_OPACITY = 0.15;
const PLAYBACK_LABEL_OPACITY = 0.4;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const LINE_Z = 400;
const COLORED_Z = 410;
const UNDERLAY_Z = 420;
const VIEWER_Z = 430;
const PINNED_Z = 440;
const AXIS_INK_Z = 505;
const MARKER_Z = 1300;
const END_LABEL_Z = 2000;
const BUBBLE_Z = 2100;

interface LayerProps {
  readonly points: readonly RankingTimelinePoint[];
  readonly series: readonly RankingTimelineSeries[];
  readonly labels: readonly string[];
  readonly revealed: number;
  readonly viewerOrder: number | null;
  readonly pinnedOrder: number | null;
  readonly colored: boolean;
}

function strokeFor(
  order: number,
  viewerOrder: number | null,
  pinnedOrder: number | null,
  colored: boolean,
): string {
  if (order === viewerOrder) return VIEWER_COLOR;
  if (order === pinnedOrder) return PINNED_COLOR;
  if (!colored) return MUTED_COLOR;
  return SERIES_COLORS[order % SERIES_COLORS.length];
}

function fitLabel(login: string, maxWidth: number): string {
  const full = `@${login}`;
  if (approxTextWidth(full) <= maxWidth) return full;
  let cut = full;
  while (cut.length > 2 && approxTextWidth(`${cut}…`) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function prefersReducedMotion(): boolean {
  return typeof window === 'undefined'
    ? false
    : window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function plotHeightFor(seriesCount: number): number {
  return clamp(
    PLOT_HEIGHT_PER_SERIES * seriesCount + PLOT_HEIGHT_BASE,
    PLOT_MIN_HEIGHT,
    PLOT_MAX_HEIGHT,
  );
}

function SketchDefs() {
  return (
    <defs>
      <filter
        id="rank-sketch-bold"
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
          seed={3}
          result="boldNoise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="boldNoise"
          scale={7}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter
        id="rank-sketch-fine"
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
          seed={7}
          result="fineNoise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="fineNoise"
          scale={4}
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

function SketchAxes() {
  const plot = usePlotArea();
  const xTicks = useXAxisTicks();
  const yTicks = useYAxisTicks();
  if (plot === undefined) return null;
  const left = plot.x;
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height + AXIS_DROP;
  const tipY = plot.y - 8;
  const tipX = right + 10;
  return (
    <g className={styles.axisInk} filter={FINE_FILTER}>
      <path d={`M${left},${bottom}L${left},${tipY}`} />
      <path
        d={`M${left - 5},${tipY + 7}L${left},${tipY}L${left + 5},${tipY + 7}`}
      />
      <path d={`M${left},${bottom}L${tipX},${bottom}`} />
      <path
        d={`M${tipX - 7},${bottom - 5}L${tipX},${bottom}L${tipX - 7},${bottom + 5}`}
      />
      {(xTicks ?? []).map((tick, index) => {
        const at = tick.coordinate;
        return typeof at === 'number' ? (
          <line
            key={`month-${String(index)}`}
            x1={at}
            y1={bottom}
            x2={at}
            y2={bottom + 6}
          />
        ) : null;
      })}
      {(yTicks ?? []).map((tick, index) => {
        const at = tick.coordinate;
        return typeof at === 'number' ? (
          <line
            key={`rank-${String(index)}`}
            x1={left - 6}
            y1={at}
            x2={left}
            y2={at}
          />
        ) : null;
      })}
    </g>
  );
}

function MarkerLayer({
  points,
  series,
  labels,
  revealed,
  viewerOrder,
  pinnedOrder,
  colored,
  bubble,
}: LayerProps & { readonly bubble: HoverBubble | null }) {
  const geometry = useGeometry();
  if (geometry === null || revealed < 1) return null;
  const { plot, xScale, yScale } = geometry;
  const lastIndex = revealed - 1;

  const at = (order: number, index: number): Pointer | null => {
    const item = series[order];
    const label = labels[index];
    if (item === undefined || label === undefined) return null;
    const rank = rankAt(item, index);
    if (rank === null) return null;
    const x = xScale(label);
    const y = yScale(rank);
    return x === undefined || y === undefined ? null : { x, y };
  };
  const lastPointOf = (order: number): Pointer | null => {
    for (let index = lastIndex; index >= 0; index -= 1) {
      const found = at(order, index);
      if (found !== null) return found;
    }
    return null;
  };

  const emphasised = [viewerOrder, pinnedOrder].filter(
    (order): order is number => order !== null,
  );
  const dotted =
    points.length === 1 ? series.map((_item, order) => order) : emphasised;
  const leader = leaderAt(series, lastIndex);
  const crown = leader === null ? null : at(leader.order, lastIndex);
  const climber = biggestClimb(series, revealed);
  const climberAt = climber === null ? null : at(climber.order, lastIndex);
  const viewerAt = viewerOrder === null ? null : lastPointOf(viewerOrder);
  const collides =
    viewerAt !== null &&
    climberAt !== null &&
    distance(viewerAt, climberAt) < ANNOTATION_COLLISION_PX;

  const bounds = {
    left: plot.x,
    right: plot.x + plot.width,
    top: plot.y,
    bottom: plot.y + plot.height,
  };
  const viewerNote =
    viewerAt === null || collides
      ? null
      : notePlacement({
          label: '나',
          anchor: viewerAt,
          below: viewerAt.y < bounds.top + 48,
          flipLeft: viewerAt.x > bounds.right - 80,
          bounds,
          swipe: false,
        });
  const climbNote =
    climber === null || climberAt === null
      ? null
      : notePlacement({
          label: `+${String(climber.climb)}칸 점프!`,
          anchor: climberAt,
          below: climberAt.y <= bounds.bottom - 48,
          flipLeft: true,
          bounds,
          swipe: true,
        });
  const coveredByBubble = (placement: NotePlacement): boolean =>
    bubble !== null && rectsOverlap(noteBox(placement), bubble.rect);

  return (
    <g>
      {crown === null ? null : (
        <g
          className={styles.crown}
          filter={FINE_FILTER}
          style={{
            transform: `translate(${String(crown.x - CROWN_HALF)}px, ${String(crown.y - CROWN_LIFT)}px)`,
          }}
        >
          <path d={CROWN_PATH} />
        </g>
      )}
      {dotted.map((order) => {
        const stroke = strokeFor(order, viewerOrder, pinnedOrder, colored);
        const faded =
          !colored && order !== viewerOrder && order !== pinnedOrder;
        return (
          <g key={`dots-${String(order)}`} filter={FINE_FILTER}>
            {Array.from({ length: revealed }, (_unused, index) => {
              const spot = at(order, index);
              return spot === null ? null : (
                <circle
                  key={`dot-${String(order)}-${String(index)}`}
                  className={styles.handDot}
                  cx={spot.x}
                  cy={spot.y}
                  r={DOT_RADIUS}
                  stroke={stroke}
                  strokeOpacity={faded ? crowdOpacity(series.length) : 1}
                />
              );
            })}
          </g>
        );
      })}
      {emphasised.map((order) => {
        const item = series[order];
        if (item === undefined || !isRookie(item)) return null;
        const first = firstRankedIndex(item);
        const spot =
          first === null || first > lastIndex ? null : at(order, first);
        return spot === null ? null : (
          <g
            key={`rookie-${String(order)}`}
            className={styles.rookie}
            filter={FINE_FILTER}
          >
            <rect x={spot.x - 5.5} y={spot.y - 5.5} width={11} height={11} />
            <rect
              x={spot.x - 5.5}
              y={spot.y - 5.5}
              width={11}
              height={11}
              transform={`rotate(45 ${String(spot.x)} ${String(spot.y)})`}
            />
            <text
              className={styles.rookieLabel}
              x={spot.x}
              y={spot.y - 12}
              textAnchor="middle"
            >
              신입!
            </text>
          </g>
        );
      })}
      {viewerNote === null ? null : (
        <PencilNote
          kind="viewer"
          placement={viewerNote}
          dimmed={coveredByBubble(viewerNote)}
        />
      )}
      {climbNote === null ? null : (
        <PencilNote
          kind="climb"
          placement={climbNote}
          dimmed={coveredByBubble(climbNote)}
        />
      )}
    </g>
  );
}

function PencilNote({
  kind,
  placement,
  dimmed,
}: {
  readonly kind: 'viewer' | 'climb';
  readonly placement: NotePlacement;
  readonly dimmed: boolean;
}) {
  const { label, anchor, x, y, width, below, flipLeft, swipe } = placement;
  const tipX = anchor.x + (flipLeft ? -6 : 6);
  const tipY = anchor.y + (below ? 6 : -6);
  const handleX = x + (flipLeft ? width : 0);
  const handleY = below ? y - 12 : y + 5;
  const controlX = (handleX + tipX) / 2;
  const controlY = below ? Math.min(handleY, tipY) - 14 : handleY + 14;
  return (
    <g
      data-note={kind}
      className={styles.note}
      opacity={dimmed ? NOTE_DIM_OPACITY : 1}
      filter={FINE_FILTER}
    >
      {swipe ? (
        <rect
          className={styles.noteSwipe}
          x={x - 3}
          y={y - 12}
          width={width + 6}
          height={16}
          transform={`rotate(-1.5 ${String(x + width / 2)} ${String(y - 4)})`}
        />
      ) : null}
      <path
        className={styles.noteArrow}
        d={`M${handleX},${handleY}Q${controlX},${controlY} ${tipX},${tipY}`}
      />
      <path
        className={styles.noteArrow}
        d={`M${tipX + (flipLeft ? -6 : 6)},${tipY - 5}L${tipX},${tipY}L${tipX + (flipLeft ? -2 : 2)},${tipY + 7}`}
      />
      <text className={styles.noteText} x={x} y={y}>
        {label}
      </text>
    </g>
  );
}

function EndLabels({
  chips,
  viewerOrder,
  pinnedOrder,
  colored,
  gutter,
  playing,
}: {
  readonly chips: readonly SeriesPick[];
  readonly viewerOrder: number | null;
  readonly pinnedOrder: number | null;
  readonly colored: boolean;
  readonly gutter: number;
  readonly playing: boolean;
}) {
  const geometry = useGeometry();
  if (geometry === null) return null;
  const { plot, yScale } = geometry;
  const placements = stackLabels(
    chips,
    viewerOrder,
    (rank) => yScale(rank) ?? plot.y,
    plot.y + plot.height,
  );
  const x = plot.x + plot.width + END_LABEL_OFFSET;
  return (
    <g
      data-end-labels=""
      className={styles.endLabels}
      opacity={playing ? PLAYBACK_LABEL_OPACITY : 1}
      filter={FINE_FILTER}
    >
      {placements.map((placement) => (
        <text
          key={`end-${String(placement.order)}`}
          className={cn(
            styles.endLabel,
            placement.isViewer && styles.endLabelViewer,
          )}
          x={x}
          y={placement.y}
          dominantBaseline="middle"
          fill={strokeFor(placement.order, viewerOrder, pinnedOrder, colored)}
        >
          {placement.isViewer
            ? `나 ${fitLabel(placement.login, gutter - VIEWER_LABEL_EXTRA - 12)}`
            : fitLabel(placement.login, gutter - 12)}
        </text>
      ))}
    </g>
  );
}

function SpeechBubble({ bubble }: { readonly bubble: HoverBubble | null }) {
  if (bubble === null) return null;
  const { rect, below, headline, total, starEstimated } = bubble;
  return (
    <foreignObject
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      pointerEvents="none"
    >
      <div className={cn(styles.bubble, below && styles.bubbleBelow)}>
        <span>{headline}</span>
        {total === null ? null : (
          <span className={styles.bubbleTotal}>
            {`합계 ${String(total)}${starEstimated ? '*' : ''}`}
          </span>
        )}
      </div>
    </foreignObject>
  );
}

function HoverLayers({
  pointer,
  ...layer
}: LayerProps & { readonly pointer: Pointer | null }) {
  const geometry = useGeometry();
  if (geometry === null) return null;
  const { plot, xScale, yScale } = geometry;
  const bubble = hoverBubble({
    points: layer.points,
    series: layer.series,
    labels: layer.labels,
    revealed: layer.revealed,
    pointer,
    plot,
    xScale: (value: string) => xScale(value),
    yScale: (rank: number) => yScale(rank),
  });
  return (
    <>
      <ZIndexLayer zIndex={MARKER_Z}>
        <MarkerLayer {...layer} bubble={bubble} />
      </ZIndexLayer>
      <ZIndexLayer zIndex={BUBBLE_Z}>
        <SpeechBubble bubble={bubble} />
      </ZIndexLayer>
    </>
  );
}

function Squiggle({ color }: { readonly color: string }) {
  return (
    <svg
      aria-hidden="true"
      width={14}
      height={8}
      viewBox="0 0 14 8"
      focusable="false"
    >
      <path
        className={styles.swatch}
        d="M1 5 Q4 1 7 5 T13 5"
        stroke={color}
        filter={FINE_FILTER}
      />
    </svg>
  );
}

function CassetteIcon() {
  return (
    <svg
      aria-hidden="true"
      width={24}
      height={14}
      viewBox="0 0 24 14"
      focusable="false"
      className={styles.cassette}
    >
      <rect x={1} y={1} width={22} height={12} rx={3} filter={FINE_FILTER} />
      <circle cx={8} cy={7} r={2.5} />
      <circle className={styles.hub} cx={16} cy={7} r={2.5} />
    </svg>
  );
}

export function RankingBumpChartLoading() {
  return (
    <div className={cn(styles.card, comicNeue.variable)}>
      <p className={styles.title}>순위 레이스</p>
      <div className={styles.viewport}>
        <svg
          aria-hidden="true"
          className={cn(styles.plot, 'motion-safe:animate-pulse')}
          height={PLOT_MIN_HEIGHT}
          viewBox="0 0 640 320"
          preserveAspectRatio="none"
          focusable="false"
        >
          <path
            className={styles.placeholder}
            d="M40 250 C 160 90, 280 270, 400 140 S 560 60, 600 110"
          />
        </svg>
      </div>
      <p className="sr-only">그래프 불러오는 중</p>
    </div>
  );
}

export function RankingBumpChart({
  timeline,
}: {
  readonly timeline: RankingTimeline;
}) {
  const { points, series, year, viewerClass, viewerGithubLogin } = timeline;
  const pointCount = points.length;
  const seriesCount = series.length;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(pointCount);
  const [playing, setPlaying] = useState(false);
  const [pinnedLogin, setPinnedLogin] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  const labels = useMemo(() => points.map(pointLabel), [points]);
  const colored = isColoredMode(seriesCount);
  const viewerOrder = useMemo(
    () =>
      viewerGithubLogin === null
        ? null
        : indexOfLogin(series, viewerGithubLogin),
    [series, viewerGithubLogin],
  );
  const pinnedOrder = useMemo(
    () => (pinnedLogin === null ? null : indexOfLogin(series, pinnedLogin)),
    [series, pinnedLogin],
  );

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setRevealed((current) => Math.min(current + 1, pointCount));
    }, PLAY_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [playing, pointCount]);

  useEffect(() => {
    if (playing && revealed >= pointCount) setPlaying(false);
  }, [playing, revealed, pointCount]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    viewport.scrollLeft = viewport.scrollWidth;
  }, []);

  const revealedPoints = reducedMotion ? pointCount : revealed;

  const rows = useMemo(
    () => buildRows(points, series, revealedPoints),
    [points, series, revealedPoints],
  );
  const domainMax = useMemo(() => rankDomainMax(series), [series]);
  const ticks = useMemo(() => rankTicks(domainMax), [domainMax]);
  const chips = useMemo(
    () => labelCandidates(series, viewerOrder),
    [series, viewerOrder],
  );
  const gutter = useMemo(
    () =>
      clamp(
        Math.round(
          chips.reduce(
            (widest, chip) =>
              Math.max(
                widest,
                approxTextWidth(`@${chip.login}`) +
                  (chip.order === viewerOrder ? VIEWER_LABEL_EXTRA : 0),
              ),
            0,
          ),
        ) + 16,
        MIN_LABEL_GUTTER,
        MAX_LABEL_GUTTER,
      ),
    [chips, viewerOrder],
  );
  const chartMargin = useMemo(
    () => ({ ...CHART_MARGIN, right: gutter }),
    [gutter],
  );

  const mutedLines = useMemo(
    () =>
      series.map((item, order) => {
        const emphasised = order === viewerOrder || order === pinnedOrder;
        if (emphasised) return null;
        const stroke = colored
          ? SERIES_COLORS[order % SERIES_COLORS.length]
          : MUTED_COLOR;
        return (
          <Line
            key={`line-${item.githubLogin}-${String(order)}`}
            zIndex={colored ? COLORED_Z : LINE_Z}
            className={cn(styles.line, styles.lineHoverable, 'rank-line')}
            type="monotone"
            dataKey={seriesKey(order)}
            stroke={stroke}
            strokeWidth={colored ? 2.5 : 1.5}
            strokeOpacity={colored ? 1 : crowdOpacity(series.length)}
            filter={colored ? BOLD_FILTER : undefined}
            dot={colored ? { r: DOT_RADIUS, strokeWidth: 2.5 } : false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        );
      }),
    [series, colored, viewerOrder, pinnedOrder],
  );

  const handleMove = useCallback(
    (_state: unknown, event: MouseEvent<SVGElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      setPointer({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    },
    [],
  );
  const handleLeave = useCallback(() => {
    setPointer(null);
  }, []);
  const togglePin = useCallback((login: string) => {
    setPinnedLogin((current) => (current === login ? null : login));
  }, []);
  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (revealed >= pointCount) setRevealed(1);
    setPlaying(true);
  }, [playing, revealed, pointCount]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    setPinnedLogin(null);
    setPointer(null);
  }, []);
  const onFind = useCallback(
    (raw: string) => {
      const needle = raw.trim().replace(/^@/, '').toLowerCase();
      if (needle.length === 0) return;
      const found = series.find(
        (item) => item.githubLogin.toLowerCase() === needle,
      );
      if (found !== undefined) setPinnedLogin(found.githubLogin);
    },
    [series],
  );

  if (pointCount === 0) return null;

  const layerProps: LayerProps = {
    points,
    series,
    labels,
    revealed: revealedPoints,
    viewerOrder,
    pinnedOrder,
    colored,
  };
  const viewerSeries = viewerOrder === null ? null : series[viewerOrder];
  const pinnedSeries = pinnedOrder === null ? null : series[pinnedOrder];
  const currentPoint = points[revealedPoints - 1] ?? points[0];
  const lastPoint = points[pointCount - 1];
  const showPlay = pointCount > 1 && !reducedMotion;
  const estimated = points.some((point) => point.starEstimated);
  const pinnedRank =
    pinnedSeries === null ? null : rankAt(pinnedSeries, revealedPoints - 1);
  const readout =
    pinnedSeries === null
      ? `${monthLabel(currentPoint)}까지 공개`
      : `@${pinnedSeries.githubLogin} ${monthLabel(currentPoint)} ${pinnedRank === null ? '순위 없음' : `${String(pinnedRank)}위`}`;

  return (
    <div
      role="group"
      aria-label={`${String(year)}년 월별 순위 변화 그래프`}
      className={cn(styles.root, comicNeue.variable)}
      data-revealed-points={revealedPoints}
      onKeyDown={onKeyDown}
    >
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <p className={styles.title}>
              <em className={styles.hl}>{year}</em> 순위 레이스
            </p>
            <p className={styles.subtitle}>
              1월부터 지금까지, 전체 참가자의 순위 변화
            </p>
          </div>
          <div className={styles.controls}>
            {showPlay ? (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className={styles.play}
                data-playing={playing}
                onClick={togglePlay}
              >
                <CassetteIcon />
                {playing ? '정지' : '재생'}
              </Button>
            ) : null}
            <span className={styles.counter}>
              {`${monthLabel(currentPoint)} / ${lastPoint === undefined ? '' : monthLabel(lastPoint)}`}
            </span>
          </div>
        </div>
        <div ref={viewportRef} className={styles.viewport}>
          <div
            aria-hidden="true"
            className={styles.plot}
            style={{ height: plotHeightFor(seriesCount) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows}
                margin={chartMargin}
                accessibilityLayer={false}
                onMouseMove={handleMove}
                onMouseLeave={handleLeave}
              >
                <SketchDefs />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  height={X_AXIS_HEIGHT}
                  tick={{ dy: X_TICK_DROP }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  reversed
                  width={Y_AXIS_WIDTH}
                  domain={[1, domainMax]}
                  ticks={ticks}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `${String(value)}위`}
                />
                {mutedLines}
                {viewerSeries === null || viewerOrder === null ? null : (
                  <Line
                    key="viewer-underlay"
                    zIndex={UNDERLAY_Z}
                    className={cn(styles.line, styles.underlay)}
                    type="monotone"
                    dataKey={seriesKey(viewerOrder)}
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
                {viewerSeries === null || viewerOrder === null ? null : (
                  <Line
                    key="viewer-line"
                    zIndex={VIEWER_Z}
                    className={cn(styles.line, 'rank-line rank-line--viewer')}
                    type="monotone"
                    dataKey={seriesKey(viewerOrder)}
                    stroke={VIEWER_COLOR}
                    strokeWidth={4}
                    filter={BOLD_FILTER}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                    data-viewer-line=""
                  />
                )}
                {pinnedSeries === null || pinnedOrder === null ? null : (
                  <Line
                    key="pinned-line"
                    zIndex={PINNED_Z}
                    className={cn(styles.line, 'rank-line rank-line--pinned')}
                    type="monotone"
                    dataKey={seriesKey(pinnedOrder)}
                    stroke={PINNED_COLOR}
                    strokeWidth={3}
                    filter={BOLD_FILTER}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
                <ZIndexLayer zIndex={AXIS_INK_Z}>
                  <SketchAxes />
                </ZIndexLayer>
                <HoverLayers {...layerProps} pointer={pointer} />
                <ZIndexLayer zIndex={END_LABEL_Z}>
                  <EndLabels
                    chips={chips}
                    viewerOrder={viewerOrder}
                    pinnedOrder={pinnedOrder}
                    colored={colored}
                    gutter={gutter}
                    playing={playing}
                  />
                </ZIndexLayer>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <FilterChipGroup aria-label="참가자 강조">
          {chips.map((chip) => (
            <FilterChip
              key={`chip-${String(chip.order)}`}
              className={styles.chip}
              pressed={chip.login === pinnedLogin}
              onClick={() => {
                togglePin(chip.login);
              }}
            >
              <Squiggle
                color={strokeFor(chip.order, viewerOrder, pinnedOrder, colored)}
              />
              {chip.order === viewerOrder
                ? `나 · @${chip.login}`
                : `@${chip.login}`}
            </FilterChip>
          ))}
        </FilterChipGroup>
        {seriesCount > chips.length ? (
          <QuickFind series={series} onFind={onFind} />
        ) : null}
        {estimated ? (
          <p
            data-star-estimated-note
            className="text-small text-muted-foreground"
          >
            * 표시된 달의 Star 수치는 추정값입니다.
          </p>
        ) : null}
        {viewerClass === RANKING_VIEWER_CLASSES.PUBLIC ? null : (
          <p
            data-org-membership-hint
            className="text-small text-muted-foreground break-keep"
          >
            조직 저장소 별은 조직 멤버십을 공개(Public)로 두고 그해 직접
            커밋·PR한 저장소만 반영됩니다.
          </p>
        )}
        <p aria-live="polite" className="sr-only">
          {readout}
        </p>
        <RaceTable
          year={year}
          points={points}
          series={series}
          chips={chips}
          viewerOrder={viewerOrder}
        />
      </div>
    </div>
  );
}

function QuickFind({
  series,
  onFind,
}: {
  readonly series: readonly RankingTimelineSeries[];
  readonly onFind: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div>
      <Input
        type="search"
        list="rank-logins"
        className={styles.find}
        aria-label="참가자 찾기"
        placeholder="이름 찾기… @login"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onFind(event.target.value);
        }}
      />
      <datalist id="rank-logins">
        {series.map((item) => (
          <option key={item.githubLogin} value={item.githubLogin} />
        ))}
      </datalist>
    </div>
  );
}

function RaceTable({
  year,
  points,
  series,
  chips,
  viewerOrder,
}: {
  readonly year: number;
  readonly points: readonly RankingTimelinePoint[];
  readonly series: readonly RankingTimelineSeries[];
  readonly chips: readonly SeriesPick[];
  readonly viewerOrder: number | null;
}): ReactNode {
  return (
    <div className="sr-only">
      <table>
        <caption>{`${String(year)}년 월별 순위 변화`}</caption>
        <thead>
          <tr>
            <th scope="col">월</th>
            {chips.map((chip) => (
              <th key={`head-${String(chip.order)}`} scope="col">
                {chip.order === viewerOrder
                  ? `나 @${chip.login}`
                  : `@${chip.login}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={point.date}>
              <th scope="row">{pointLabel(point)}</th>
              {chips.map((chip) => {
                const item = series[chip.order];
                const rank = item === undefined ? null : rankAt(item, index);
                return (
                  <td key={`cell-${String(chip.order)}-${String(index)}`}>
                    {rank === null ? '—' : `${String(rank)}위`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
