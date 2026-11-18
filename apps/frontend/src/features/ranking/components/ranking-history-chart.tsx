'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  CartesianGrid,
  DefaultZIndexes,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ZIndexLayer,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  type TooltipContentProps,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { RankingTimeline } from '../types';
import {
  buildRankingHistoryChart,
  rankingHistoryAvatarSlots,
  RANKING_HISTORY_COMPACT_LEGEND_LIMIT,
  rankingHistoryLogRows,
  rankingHistoryLogTicks,
  type RankingHistoryChart as HistoryChart,
  type RankingHistoryLine,
  type RankingHistoryRow,
} from './ranking-history-model';
import styles from './ranking-history-chart.module.css';

const WOBBLE_FILTER_ID = 'ranking-history-wobble';
const TICK = {
  fill: 'var(--muted-foreground)',
  fontSize: 12,
} as const;
const CURSOR = {
  stroke: 'var(--muted-foreground)',
  strokeDasharray: '4 4',
} as const;
const MARGIN = { top: 12, right: 36, left: 0, bottom: 0 } as const;
const FADED_OPACITY = 0.28;

function Note(props: { readonly state: string; readonly text: string }) {
  return (
    <div className={styles.root} data-history-chart={props.state}>
      <p className={styles.caption}>{props.text}</p>
    </div>
  );
}

export function RankingHistoryChartLoading() {
  return (
    <HistoryCard
      state="loading"
      legend={
        <div className={styles.legendPlaceholder} aria-hidden="true">
          <SkeletonBlock className="h-lh w-1/2 rounded-sm" />
          <SkeletonBlock className="h-lh w-1/3 rounded-sm" />
        </div>
      }
    >
      <div className="grid h-full content-start justify-items-center pt-4">
        <p className={styles.caption} role="status">
          순위 변화를 그리는 중입니다…
        </p>
      </div>
    </HistoryCard>
  );
}

export function RankingHistoryChartError() {
  return <Note state="error" text="순위 변화 그래프를 불러오지 못했습니다." />;
}

function HistoryCard({
  state,
  viewerGithubLogin,
  logScale,
  onToggleScale,
  legend,
  plotLabel,
  children,
}: {
  readonly state: 'loading' | 'ready';
  readonly viewerGithubLogin?: string;
  readonly logScale?: boolean;
  readonly onToggleScale?: () => void;
  readonly legend: ReactNode;
  readonly plotLabel?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={styles.root}
      data-history-chart={state}
      data-viewer-login={viewerGithubLogin}
    >
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>순위 변화</h3>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(styles.scaleToggle, 'h-auto px-1')}
            aria-pressed={logScale}
            disabled={onToggleScale === undefined}
            onClick={onToggleScale}
          >
            로그 축
          </Button>
        </div>
        <p className={styles.caption}>월별로 쌓인 올해 누적 점수입니다.</p>
      </div>
      <div className={styles.body}>
        {legend}
        <div
          className={styles.plot}
          role={plotLabel === undefined ? undefined : 'img'}
          aria-label={plotLabel}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function RankingHistoryChart({
  timeline,
  viewerGithubLogin,
}: {
  readonly timeline: RankingTimeline;
  readonly viewerGithubLogin: string | null;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [logScale, setLogScale] = useState(false);
  const chart = useMemo(
    () => buildRankingHistoryChart(timeline, viewerGithubLogin),
    [timeline, viewerGithubLogin],
  );
  const toggle = (login: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (!next.delete(login)) next.add(login);
      return next;
    });
  };
  const opacityOf = (line: RankingHistoryLine) => {
    if (focused !== null) return focused === line.githubLogin ? 1 : 0.12;
    return line.faded ? FADED_OPACITY : 1;
  };
  const rows = logScale ? rankingHistoryLogRows(chart.rows) : chart.rows;
  if (chart.lines.length === 0) {
    return <Note state="empty" text="아직 그릴 활동 기록이 없습니다." />;
  }
  if (chart.rows.length < 2) {
    return <Note state="empty" text="그래프는 두 번째 달부터 그려집니다." />;
  }

  return (
    <HistoryCard
      state="ready"
      viewerGithubLogin={viewerGithubLogin ?? ''}
      logScale={logScale}
      onToggleScale={() => setLogScale((current) => !current)}
      plotLabel={summaryOf(timeline, chart)}
      legend={
        <ul className={styles.legend} aria-label="상위 참여자">
          {chart.legend.map((line) => (
            <li
              key={line.key}
              className={styles.legendItem}
              data-legend-login={line.githubLogin}
              data-legend-compact={
                line.isViewer ||
                line.finalRank <= RANKING_HISTORY_COMPACT_LEGEND_LIMIT
                  ? 'keep'
                  : 'hide'
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(styles.legendButton, 'h-auto px-1')}
                aria-pressed={!hidden.has(line.githubLogin)}
                onClick={() => toggle(line.githubLogin)}
                onMouseEnter={() => setFocused(line.githubLogin)}
                onMouseLeave={() => setFocused(null)}
                onFocus={() => setFocused(line.githubLogin)}
                onBlur={() => setFocused(null)}
              >
                <Swatch line={line} />
                <span className={styles.rank}>{line.finalRank}</span>
                <span className={styles.login}>@{line.githubLogin}</span>
                {line.isViewer ? <span className={styles.me}>나</span> : null}
              </Button>
            </li>
          ))}
        </ul>
      }
    >
      <WobbleDefs />
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...rows]} margin={MARGIN}>
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            minTickGap={4}
            interval="preserveStartEnd"
          />
          <YAxis
            width={56}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            {...(logScale
              ? {
                  scale: 'log' as const,
                  domain: [1, 'dataMax'] as [number, string],
                  ticks: [...rankingHistoryLogTicks(chart.lines)],
                  allowDataOverflow: true,
                }
              : {})}
          />
          <Tooltip
            cursor={CURSOR}
            content={(props: TooltipContentProps) => (
              <HistoryTooltip
                active={props.active}
                label={props.label}
                chart={chart}
              />
            )}
          />
          {chart.lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.githubLogin}
              stroke={line.color}
              strokeWidth={line.strokeWidth}
              strokeOpacity={opacityOf(line)}
              hide={hidden.has(line.githubLogin)}
              onMouseEnter={() => setFocused(line.githubLogin)}
              onMouseLeave={() => setFocused(null)}
              className={line.faded ? undefined : styles.sketched}
              dot={line.showDot ? { r: 2.5 } : false}
              activeDot={line.isViewer}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <LineAvatars
            lines={chart.lines.filter(
              (line) => !line.faded && !hidden.has(line.githubLogin),
            )}
            rows={rows}
            opacityOf={opacityOf}
          />
        </LineChart>
      </ResponsiveContainer>
    </HistoryCard>
  );
}

function WobbleDefs() {
  return (
    <svg className={styles.defs} aria-hidden="true" focusable="false">
      <filter
        id={WOBBLE_FILTER_ID}
        filterUnits="userSpaceOnUse"
        x={-48}
        y={-48}
        width={2400}
        height={1200}
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.025"
          numOctaves={1}
          seed={17}
          result="warp"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="warp"
          scale={9}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}

const AVATAR_SIZE = 22;
const AVATAR_RING = 2;
const AVATAR_OFFSET = 10;

function LineAvatars({
  lines,
  rows,
  opacityOf,
}: {
  readonly lines: readonly RankingHistoryLine[];
  readonly rows: readonly RankingHistoryRow[];
  readonly opacityOf: (line: RankingHistoryLine) => number;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (xScale === undefined || yScale === undefined || plot === undefined) {
    return null;
  }
  const r = AVATAR_SIZE / 2;
  const tips = lines.flatMap((line) => {
    const row = rows[line.tipIndex];
    const value = row?.[line.key];
    const x = xScale(row?.label, { position: 'middle' });
    const y = typeof value === 'number' ? yScale(value) : undefined;
    return x === undefined || y === undefined ? [] : [{ line, x, y }];
  });
  const slots = rankingHistoryAvatarSlots(
    tips.map((tip) => tip.y),
    AVATAR_SIZE + AVATAR_RING,
    plot.y + r,
    plot.y + plot.height - r,
  );

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      {tips.map(({ line, x, y }, index) => {
        const cx = x + AVATAR_OFFSET + r;
        const cy = slots[index] ?? y;
        const clipId = `ranking-avatar-${line.key}`;
        return (
          <g
            key={line.key}
            data-line-avatar={line.githubLogin}
            opacity={opacityOf(line)}
          >
            <line
              x1={x}
              y1={y}
              x2={cx - r}
              y2={cy}
              stroke={line.color}
              strokeWidth={1.5}
            />
            <clipPath id={clipId}>
              <circle cx={cx} cy={cy} r={r} />
            </clipPath>
            <circle cx={cx} cy={cy} r={r + AVATAR_RING} fill={line.color} />
            <image
              href={`https://github.com/${line.githubLogin}.png?size=${String(AVATAR_SIZE * 2)}`}
              x={cx - r}
              y={cy - r}
              width={AVATAR_SIZE}
              height={AVATAR_SIZE}
              clipPath={`url(#${clipId})`}
              onDragStart={(event) => event.preventDefault()}
            />
          </g>
        );
      })}
    </ZIndexLayer>
  );
}

function Swatch({ line }: { readonly line: RankingHistoryLine }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.swatch}
      viewBox="0 0 16 4"
      opacity={line.faded ? FADED_OPACITY : 1}
    >
      <line x1={0} y1={2} x2={16} y2={2} stroke={line.color} strokeWidth={3} />
    </svg>
  );
}

function HistoryTooltip({
  active,
  label,
  chart,
}: {
  readonly active: boolean;
  readonly label: string | number | undefined;
  readonly chart: HistoryChart;
}) {
  const index = chart.rows.findIndex((row) => row.label === label);
  if (!active || index < 0) return null;
  const entries = chart.legend
    .map((line) => ({
      line,
      total: line.totals[index] ?? null,
      rank: line.ranks[index] ?? null,
    }))
    .filter((entry) => entry.total !== null)
    .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
  if (entries.length === 0) return null;

  return (
    <div className={styles.tooltip} data-history-tooltip="">
      <p className={styles.tooltipLabel}>{label}</p>
      <ul className={styles.tooltipList}>
        {entries.map((entry) => (
          <li key={entry.line.key} className={styles.tooltipRow}>
            <Swatch line={entry.line} />
            <span className={styles.login}>@{entry.line.githubLogin}</span>
            <span className={styles.score}>{entry.total}점</span>
            <span className={styles.rankCell}>
              {entry.rank === null ? '–' : `${String(entry.rank)}위`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function summaryOf(timeline: RankingTimeline, chart: HistoryChart): string {
  const first = chart.rows[0]?.label ?? '';
  const last = chart.rows.at(-1)?.label ?? '';
  const leader = chart.legend[0];
  const lead =
    leader === undefined
      ? ''
      : ` 1위는 @${leader.githubLogin} ${String(leader.totals.at(-1) ?? 0)}점입니다.`;
  return `${String(timeline.year)}년 ${first}부터 ${last}까지 참여자 ${String(chart.lines.length)}명의 누적 점수 변화 꺾은선 그래프입니다.${lead}`;
}
