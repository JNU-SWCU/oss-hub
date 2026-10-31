'use client';

import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RankingTimeline } from '../types';
import { comicNeue } from './comic-font';
import {
  buildRankingHistoryChart,
  RANKING_HISTORY_COMPACT_LEGEND_LIMIT,
  type RankingHistoryChart as HistoryChart,
  type RankingHistoryLine,
} from './ranking-history-model';
import styles from './ranking-history-chart.module.css';

const WOBBLE_FILTER_ID = 'ranking-history-wobble';
const TICK = {
  fill: 'var(--muted-foreground)',
  fontFamily: 'var(--font-comic), var(--font-sans)',
  fontSize: 12,
} as const;
const CURSOR = {
  stroke: 'var(--muted-foreground)',
  strokeDasharray: '4 4',
} as const;
const MARGIN = { top: 8, right: 16, left: 0, bottom: 0 } as const;
const FADED_OPACITY = 0.28;

function Note(props: { readonly state: string; readonly text: string }) {
  return (
    <div
      className={cn(styles.root, comicNeue.variable)}
      data-history-chart={props.state}
    >
      <p className={styles.caption}>{props.text}</p>
    </div>
  );
}

export function RankingHistoryChartLoading() {
  return <Note state="loading" text="순위 변화를 그리는 중입니다…" />;
}

export function RankingHistoryChart({
  timeline,
}: {
  readonly timeline: RankingTimeline;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const chart = buildRankingHistoryChart(timeline);
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
  if (chart.lines.length === 0 || chart.rows.length === 0) {
    return <Note state="empty" text="아직 그릴 활동 기록이 없습니다." />;
  }

  return (
    <div
      className={cn(styles.root, comicNeue.variable)}
      data-history-chart="ready"
      data-viewer-login={timeline.viewerGithubLogin ?? ''}
    >
      <WobbleDefs />
      <div className={styles.head}>
        <h3 className={styles.title}>순위 변화</h3>
        <p className={styles.caption}>
          월말 스냅샷과 지금까지 쌓인 누적 점수입니다.
          {timeline.points.some((point) => point.starEstimated)
            ? ' 일부 달의 Star는 추정값입니다.'
            : ''}
        </p>
      </div>
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
      <div
        className={styles.plot}
        role="img"
        aria-label={summaryOf(timeline, chart)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={[...chart.rows]}
            margin={MARGIN}
            accessibilityLayer={false}
          >
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
                strokeDasharray={line.dash}
                strokeOpacity={opacityOf(line)}
                hide={hidden.has(line.githubLogin)}
                onMouseEnter={() => setFocused(line.githubLogin)}
                onMouseLeave={() => setFocused(null)}
                className={line.faded ? undefined : styles.sketched}
                dot={line.isViewer ? { r: 2.5 } : false}
                activeDot={line.isViewer}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
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

function Swatch({ line }: { readonly line: RankingHistoryLine }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.swatch}
      viewBox="0 0 16 4"
      opacity={line.faded ? FADED_OPACITY : 1}
    >
      <line
        x1={0}
        y1={2}
        x2={16}
        y2={2}
        stroke={line.color}
        strokeWidth={3}
        strokeDasharray={line.dash}
      />
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
