'use client';

import { AlertCircle, Hourglass, Link2Off } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, FilterChip, FilterChipGroup } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { formatSeoulDate } from './program-detail-format';
import type { TeamActivity, TeamActivityMetric } from './team-activity-api';
import { weeklyActivity } from './team-activity-weeks';

const METRICS = [
  { key: 'commitCount', label: 'Commit' },
  { key: 'pullRequestCount', label: 'PR' },
  { key: 'issueCount', label: 'Issue' },
] as const satisfies readonly {
  readonly key: TeamActivityMetric;
  readonly label: string;
}[];

/** 팀원 색은 차트 토큰 다섯 개를 돌려 쓰고, 여섯 번째부터는 점선으로 구분한다. */
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;

/** `2026-09-21` → 축은 `09.21`, 표·말풍선은 `2026.09.21 주`. */
function axisLabel(week: string): string {
  return week.slice(5).replace('-', '.');
}
function weekLabel(week: string): string {
  return `${week.replaceAll('-', '.')} 주`;
}

function Swatch({
  color,
  dashed,
}: {
  readonly color: string | null;
  readonly dashed: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'w-4 shrink-0 border-t-2',
        dashed && 'border-dashed',
        color === null && 'border-muted-foreground',
      )}
      style={color === null ? undefined : { borderColor: color }}
    />
  );
}

/**
 * 학생 팀 화면과 교직원 팀 상세가 같은 조회(`getTeamActivity`)로 그리는 한 그래프(#1133).
 *
 * 숫자는 가리키거나 초점을 줄 때만 말풍선으로 보인다. 같은 숫자는 보이지 않는 표로
 * 낭독기에 남는다. 아직 모으지 못한 것은 0으로 그리지 않는다.
 */
export function TeamActivityGraph({
  activity,
  label,
}: {
  readonly activity: TeamActivity;
  /** 이 그래프가 놓인 카드의 제목. 초점을 받는 그래프의 이름이 된다. */
  readonly label: string;
}) {
  switch (activity.status) {
    case 'NOT_CONNECTED':
      return (
        <EmptyState
          className="break-keep"
          icon={<Link2Off aria-hidden="true" />}
          title="아직 연결한 저장소가 없습니다"
          description="저장소를 연결하면 팀원별 활동이 여기에 그려집니다."
        />
      );
    case 'NOT_COLLECTED':
      return (
        <EmptyState
          className="break-keep"
          icon={<Hourglass aria-hidden="true" />}
          title="첫 수집을 기다리는 중입니다"
          description="수집이 끝나면 그래프가 그려집니다."
        />
      );
    case 'ERROR':
      return (
        <>
          <Alert variant="destructive" role="note">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>최근 수집에 실패했습니다</AlertTitle>
            <AlertDescription className="break-keep">
              {activity.lastSuccessAt === null
                ? '아직 모은 활동이 없습니다. 잠시 후 다시 확인해 주세요.'
                : `마지막 수집 ${formatSeoulDate(activity.lastSuccessAt)}까지의 활동입니다. 잠시 후 다시 확인해 주세요.`}
            </AlertDescription>
          </Alert>
          {activity.lastSuccessAt === null ? null : (
            <WeeklyChart activity={activity} label={label} dimmed />
          )}
        </>
      );
    case 'COLLECTED':
      return <WeeklyChart activity={activity} label={label} dimmed={false} />;
  }
}

function WeeklyChart({
  activity,
  label,
  dimmed,
}: {
  readonly activity: TeamActivity;
  readonly label: string;
  readonly dimmed: boolean;
}) {
  const [metric, setMetric] = useState<TeamActivityMetric>('commitCount');
  const [active, setActive] = useState<number | null>(null);
  const weekly = useMemo(
    () => weeklyActivity(activity, Date.now()),
    [activity],
  );
  const { weeks } = weekly;
  const last = weeks.length - 1;
  const series = weekly.members.map((item, index) => ({
    ...item,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    dashed: index >= SERIES_COLORS.length,
  }));
  const metricLabel =
    METRICS.find((item) => item.key === metric)?.label ?? metric;
  /** `active`는 다시 읽기 전의 칸일 수 있다 — 범위 밖이면 말풍선이 닫혀 이 0은 그려지지 않는다. */
  const valueAt = (item: (typeof series)[number], week: number) =>
    item.weeks[week]?.[metric] ?? 0;
  const teamTotal = (week: number) =>
    series.reduce((sum, item) => sum + valueAt(item, week), 0);
  const data = weeks.map((week, index) => ({
    week,
    ...Object.fromEntries(
      series.map((item, member) => [`m${member}`, valueAt(item, index)]),
    ),
  }));
  const activeWeek = active === null ? undefined : weeks[active];
  const readout =
    active === null || activeWeek === undefined
      ? ''
      : `${weekLabel(activeWeek)} ${metricLabel}: ${series
          .map((item) => `@${item.member.githubLogin} ${valueAt(item, active)}`)
          .join(', ')}, 팀 합계 ${teamTotal(active)}`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = active ?? last;
    const next = {
      ArrowLeft: Math.max(0, from - 1),
      ArrowRight: Math.min(last, from + 1),
      Home: 0,
      End: last,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  }

  return (
    <div className="grid gap-4">
      <FilterChipGroup aria-label="지표">
        {METRICS.map((item) => (
          <FilterChip
            key={item.key}
            pressed={metric === item.key}
            onClick={() => setMetric(item.key)}
          >
            {item.label}
          </FilterChip>
        ))}
      </FilterChipGroup>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label} 그래프 — 왼쪽·오른쪽 화살표로 주를 옮깁니다`}
        data-slot="team-activity-chart"
        className="relative rounded-control outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onFocus={() => setActive((current) => current ?? last)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {/* 흐리게 두는 것은 선과 범례뿐이다 — 칩과 말풍선의 숫자는 또렷하게 읽힌다. */}
        <div
          aria-hidden="true"
          data-slot="team-activity-plot"
          className={cn('h-64 w-full', dimmed && 'opacity-60')}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              accessibilityLayer={false}
              margin={{ top: 12, right: 12, left: -12, bottom: 4 }}
              onMouseMove={(state) => {
                const index = Number(state.activeTooltipIndex ?? Number.NaN);
                if (Number.isInteger(index) && index >= 0 && index <= last) {
                  setActive(index);
                }
              }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="week"
                tickFormatter={axisLabel}
                tick={TICK}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                width={44}
                tick={TICK}
                tickLine={false}
                axisLine={false}
              />
              {activeWeek === undefined ? null : (
                <ReferenceLine
                  x={activeWeek}
                  stroke="var(--muted-foreground)"
                />
              )}
              {series.map((item, member) =>
                item.contributed ? (
                  <Line
                    key={item.member.userId}
                    type="monotone"
                    dataKey={`m${member}`}
                    stroke={item.color}
                    strokeDasharray={item.dashed ? '6 4' : undefined}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {active === null || activeWeek === undefined ? null : (
          <div
            aria-hidden="true"
            data-slot="team-activity-readout"
            className={cn(
              'pointer-events-none absolute top-2 z-10 grid min-w-44 gap-1 rounded-control border border-border',
              'bg-background p-3 text-small shadow-md',
              active > last / 2 ? 'left-12' : 'right-2',
            )}
          >
            <p className="font-semibold">
              {weekLabel(activeWeek)} · {metricLabel}
            </p>
            <ul className="grid gap-0.5">
              {series.map((item) => (
                <li
                  key={item.member.userId}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Swatch
                      color={item.contributed ? item.color : null}
                      dashed={item.dashed || !item.contributed}
                    />
                    <span className="truncate">@{item.member.githubLogin}</span>
                  </span>
                  <span className="tabular-nums">{valueAt(item, active)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
              <span>팀 합계</span>
              <span className="tabular-nums">{teamTotal(active)}</span>
            </p>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {readout}
        </p>
      </div>
      <ul
        className={cn(
          'flex flex-wrap gap-x-4 gap-y-1 text-small',
          dimmed && 'opacity-60',
        )}
        aria-label="팀원"
      >
        {series.map((item) => (
          <li key={item.member.userId} className="flex items-center gap-2">
            <Swatch
              color={item.contributed ? item.color : null}
              dashed={item.dashed || !item.contributed}
            />
            <span className="break-all">@{item.member.githubLogin}</span>
            {item.contributed ? null : (
              <span className="text-muted-foreground">이 기간 기여 없음</span>
            )}
          </li>
        ))}
      </ul>
      {!dimmed && activity.lastSuccessAt !== null ? (
        <p className="text-small text-muted-foreground">
          마지막 수집 {formatSeoulDate(activity.lastSuccessAt)}
        </p>
      ) : null}
      {/* `sr-only`를 표에 직접 주면 폭 1px·넘침 숨김이 표 배치에 먹지 않아 머리글 폭만큼
          화면이 가로로 넘친다(390폭 447px) — 숨김은 감싸는 div가 맡는다. */}
      <div className="sr-only">
        <table>
          <caption>{`${label} — 주별 ${metricLabel}`}</caption>
          <thead>
            <tr>
              <th scope="col">주</th>
              {series.map((item) => (
                <th key={item.member.userId} scope="col">
                  @{item.member.githubLogin}
                </th>
              ))}
              <th scope="col">팀 합계</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, index) => (
              <tr key={week}>
                <th scope="row">{weekLabel(week)}</th>
                {series.map((item) => (
                  <td key={item.member.userId}>{valueAt(item, index)}</td>
                ))}
                <td>{teamTotal(index)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
