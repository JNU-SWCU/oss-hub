'use client';

import { AlertCircle, ChevronDown } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import { EmptyState, FailureState } from '@/components';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useProgramActivityQuery } from '../queries';
import { formatSeoulDate } from '../program-detail-format';
import type { ProgramActivity } from '../dto';
import type { ViewerRole } from '../../program-contract';

export type ActivityState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly activities: readonly ProgramActivity[] };

const METRICS = [
  {
    key: 'commitCount',
    label: 'Commit',
    color: 'var(--chart-1)',
    swatch: 'bg-chart-1',
  },
  {
    key: 'pullRequestCount',
    label: 'PR',
    color: 'var(--chart-2)',
    swatch: 'bg-chart-2',
  },
  {
    key: 'releaseCount',
    label: 'Release',
    color: 'var(--chart-3)',
    swatch: 'bg-chart-3',
  },
] as const;

type Metric = (typeof METRICS)[number];

const TEAM_AXIS_WIDTH = 96;
const SHARED_AXIS_PEEK = 8;
const ROW_HEIGHT = 32;
const BAR_SIZE = 16;
const VALUE_AXIS_HEIGHT = 28;
const CHART_MARGIN = { top: 4, right: 44, bottom: 0, left: 0 } as const;
const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;
const TEAM_AXIS_STYLE = {
  '--team-axis': `${TEAM_AXIS_WIDTH}px`,
  '--team-axis-peek': `${SHARED_AXIS_PEEK}px`,
  '--team-axis-hidden': `${TEAM_AXIS_WIDTH - SHARED_AXIS_PEEK}px`,
} as CSSProperties;

const STATUS_NOTES: Partial<
  Record<ProgramActivity['collectionStatus'], string>
> = {
  NOT_CONNECTED: '저장소가 연결되지 않았습니다.',
  EMPTY: '아직 수집된 활동이 없습니다.',
};

const COMPACT_ALERT_CLASS = 'px-4 py-3 text-sm';
const DENSE_HEAD_CLASS = 'px-3 py-2 first:pl-0';
const DENSE_CELL_CLASS = 'px-3 py-2 first:pl-0';
const TEAM_NAME_CLASS =
  'min-w-0 font-semibold break-keep [overflow-wrap:anywhere]';
const TEAM_TRIGGER_CLASS = cn(
  'group flex min-h-control w-full items-center gap-3 rounded-sm py-2 text-left',
  'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
);
const TEAM_CHEVRON_CLASS = cn(
  'size-4 shrink-0 text-muted-foreground transition-transform',
  'group-data-[state=open]:rotate-180 motion-reduce:transition-none',
);

function hasCollectedData(activity: ProgramActivity): boolean {
  return (
    activity.collectionStatus === 'READY' ||
    activity.collectionStatus === 'FAILED'
  );
}

function dataAsOfCaption(
  activities: readonly ProgramActivity[],
): string | null {
  const times = activities
    .flatMap((activity) =>
      activity.collectionStatus === 'READY' && activity.dataAsOf !== null
        ? [activity.dataAsOf]
        : [],
    )
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const oldest = times.at(0);
  const newest = times.at(-1);
  if (oldest === undefined || newest === undefined) return null;
  const from = formatSeoulDate(oldest);
  const to = formatSeoulDate(newest);
  return from === to ? `데이터 기준 ${to}` : `데이터 기준 ${from} ~ ${to}`;
}

function CollectionAlerts({
  activities,
  named,
}: {
  readonly activities: readonly ProgramActivity[];
  readonly named: boolean;
}) {
  const title = (activity: ProgramActivity, text: string): string =>
    named ? `${activity.label} · ${text}` : text;
  return (
    <>
      {activities
        .filter((activity) => activity.collectionStatus === 'FAILED')
        .map((activity) => (
          <Alert
            key={activity.teamId}
            variant="destructive"
            role="note"
            className={COMPACT_ALERT_CLASS}
          >
            <AlertCircle aria-hidden="true" />
            <AlertTitle>
              {title(activity, '활동 수집에 실패했습니다')}
            </AlertTitle>
            <AlertDescription className="text-sm break-keep">
              {activity.dataAsOf === null
                ? '잠시 후 다시 확인해 주세요.'
                : `${formatSeoulDate(activity.dataAsOf)}에 마지막으로 수집된 값입니다. 잠시 후 다시 확인해 주세요.`}
            </AlertDescription>
          </Alert>
        ))}
      {activities
        .filter((activity) => activity.hasIncompleteContributions)
        .map((activity) => (
          <Alert
            key={activity.teamId}
            role="note"
            className={COMPACT_ALERT_CLASS}
          >
            <AlertCircle aria-hidden="true" />
            <AlertTitle>
              {title(activity, '기여도 수집이 온전하지 않습니다')}
            </AlertTitle>
            <AlertDescription className="text-sm break-keep">
              팀원별 합계와 팀 합계가 다릅니다. 수집 당시 팀 명단을 확인하지
              못했을 수 있습니다.
            </AlertDescription>
          </Alert>
        ))}
    </>
  );
}

interface TeamTickProps {
  readonly x?: number;
  readonly y?: number;
  readonly payload?: { readonly index: number };
  readonly teams: readonly ProgramActivity[];
}

function TeamTick({
  x = 0,
  y = 0,
  payload,
  teams,
}: TeamTickProps): ReactElement | null {
  const team = payload === undefined ? undefined : teams[payload.index];
  if (team === undefined) return null;
  return (
    <foreignObject x={0} y={y - 10} width={Math.max(x - 8, 0)} height={20}>
      <div className="flex h-full items-center gap-1 text-small text-foreground">
        <span className="truncate">{team.label}</span>
        {team.collectionStatus === 'FAILED' ? (
          <AlertCircle className="size-3 shrink-0 text-destructive" />
        ) : team.hasIncompleteContributions ? (
          <AlertCircle className="size-3 shrink-0 text-status-pending-fg" />
        ) : null}
      </div>
    </foreignObject>
  );
}

function MetricChart({
  metric,
  teams,
  sharesTeamAxis,
}: {
  readonly metric: Metric;
  readonly teams: readonly ProgramActivity[];
  readonly sharesTeamAxis: boolean;
}) {
  return (
    <div
      data-slot="activity-chart"
      data-metric={metric.key}
      className={cn(
        'min-w-0 overflow-hidden @2xl:grow',
        sharesTeamAxis
          ? '@2xl:basis-(--team-axis-peek)'
          : '@2xl:basis-(--team-axis)',
      )}
    >
      <div
        className={cn(
          'grid gap-2',
          sharesTeamAxis && [
            '@2xl:-ml-(--team-axis-hidden)',
            '@2xl:w-[calc(100%+var(--team-axis-hidden))]',
          ],
        )}
      >
        <p className="flex items-center gap-2 pl-(--team-axis) text-small font-semibold">
          <span className={cn('size-2.5 rounded-xs', metric.swatch)} />
          {metric.label}
        </p>
        <div
          style={{
            height:
              teams.length * ROW_HEIGHT + VALUE_AXIS_HEIGHT + CHART_MARGIN.top,
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              accessibilityLayer={false}
              layout="vertical"
              data={[...teams]}
              margin={CHART_MARGIN}
              barSize={BAR_SIZE}
            >
              <CartesianGrid
                horizontal={false}
                strokeDasharray="3 3"
                stroke="var(--border)"
              />
              <XAxis
                type="number"
                tickCount={3}
                allowDecimals={false}
                height={VALUE_AXIS_HEIGHT}
                tick={TICK}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="teamId"
                width={TEAM_AXIS_WIDTH}
                tick={<TeamTick teams={teams} />}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                interval={0}
              />
              <Bar
                dataKey={metric.key}
                fill={metric.color}
                isAnimationActive={false}
                shape={({
                  x,
                  y,
                  width,
                  height,
                  fill,
                  index,
                }: BarShapeProps) => (
                  <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={fill}
                    radius={2}
                    fillOpacity={
                      teams[index]?.collectionStatus === 'FAILED' ? 0.5 : 1
                    }
                  />
                )}
              >
                <LabelList
                  dataKey={metric.key}
                  position="right"
                  offset={6}
                  fill="var(--foreground)"
                  fontSize={12}
                  fontWeight={600}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function TeamCharts({ teams }: { readonly teams: readonly ProgramActivity[] }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="grid gap-6 @2xl:flex"
        style={TEAM_AXIS_STYLE}
      >
        {METRICS.map((metric, index) => (
          <MetricChart
            key={metric.key}
            metric={metric}
            teams={teams}
            sharesTeamAxis={index > 0}
          />
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>팀별 활동</caption>
          <thead>
            <tr>
              <th scope="col">팀</th>
              {METRICS.map((metric) => (
                <th key={metric.key} scope="col">
                  {metric.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.teamId}>
                <th scope="row">{team.label}</th>
                {METRICS.map((metric) => (
                  <td key={metric.key}>{team[metric.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MemberTable({ activity }: { readonly activity: ProgramActivity }) {
  return (
    <Table
      scrollRegionLabel={`${activity.label} 팀원별 기여`}
      className="text-small"
    >
      <TableHeader>
        <TableRow>
          <TableHead className={DENSE_HEAD_CLASS}>팀원</TableHead>
          {METRICS.map((metric) => (
            <TableHead
              key={metric.key}
              className={cn(DENSE_HEAD_CLASS, 'text-right')}
            >
              {metric.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {activity.members.map((member) => (
          <TableRow key={member.githubLogin}>
            <TableCell
              className={cn(
                DENSE_CELL_CLASS,
                'whitespace-normal [overflow-wrap:anywhere]',
              )}
            >
              @{member.githubLogin}
            </TableCell>
            {METRICS.map((metric) => (
              <TableCell
                key={metric.key}
                className={cn(DENSE_CELL_CLASS, 'text-right tabular-nums')}
              >
                {member[metric.key]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TeamContributions({
  activities,
}: {
  readonly activities: readonly ProgramActivity[];
}) {
  const rows = activities.filter(
    (activity) =>
      STATUS_NOTES[activity.collectionStatus] !== undefined ||
      activity.members.length > 0,
  );
  if (rows.length === 0) return null;
  return (
    <ul aria-label="팀원별 기여" className="border-t border-border">
      {rows.map((activity) => {
        const note = STATUS_NOTES[activity.collectionStatus];
        return (
          <li
            key={activity.teamId}
            className="border-b border-border/50 last:border-b-0"
          >
            {note === undefined ? (
              <Collapsible>
                <CollapsibleTrigger className={TEAM_TRIGGER_CLASS}>
                  <span className={TEAM_NAME_CLASS}>{activity.label}</span>
                  <span className="ml-auto shrink-0 text-small text-muted-foreground">
                    팀원별 기여 ({activity.members.length}명)
                  </span>
                  <ChevronDown aria-hidden className={TEAM_CHEVRON_CLASS} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pb-3">
                  <MemberTable activity={activity} />
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="flex min-h-control flex-wrap items-center gap-x-3 py-2">
                <span className={TEAM_NAME_CLASS}>{activity.label}</span>
                <span className="ml-auto text-small text-muted-foreground">
                  {note}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DataCaption({
  activities,
}: {
  readonly activities: readonly ProgramActivity[];
}) {
  const caption = dataAsOfCaption(activities);
  return caption === null ? null : (
    <p className="text-small text-muted-foreground">{caption}</p>
  );
}

function TeamComparison({
  activities,
}: {
  readonly activities: readonly ProgramActivity[];
}) {
  const charted = activities.filter(hasCollectedData);
  return (
    <div className="@container grid grid-cols-[minmax(0,1fr)] gap-4">
      <CollectionAlerts activities={activities} named />
      {charted.length > 0 ? <TeamCharts teams={charted} /> : null}
      <TeamContributions activities={activities} />
      <DataCaption activities={activities} />
    </div>
  );
}

function SingleTeamActivity({
  activity,
}: {
  readonly activity: ProgramActivity;
}) {
  const note = STATUS_NOTES[activity.collectionStatus];
  if (note !== undefined) {
    return <p className="text-small text-muted-foreground">{note}</p>;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <CollectionAlerts activities={[activity]} named={false} />
      <dl className="grid grid-cols-3 gap-4">
        {METRICS.map((metric) => (
          <div key={metric.key} className="grid gap-0.5">
            <dt className="text-small text-muted-foreground">{metric.label}</dt>
            <dd className="text-section leading-tight font-bold tabular-nums">
              {activity[metric.key]}
            </dd>
          </div>
        ))}
      </dl>
      {activity.members.length > 0 ? (
        <>
          <p className="text-small font-semibold">
            팀원별 기여 ({activity.members.length}명)
          </p>
          <MemberTable activity={activity} />
        </>
      ) : null}
      <DataCaption activities={[activity]} />
    </div>
  );
}

export function ActivityPanelBody({
  state,
  onRetry,
  compareTeams = true,
}: {
  readonly state: ActivityState;
  readonly onRetry: () => void;
  readonly compareTeams?: boolean;
}) {
  if (state.kind === 'loading')
    return (
      <Skeleton label="활동 불러오는 중">
        <SkeletonBlock className="h-24 rounded-card" />
      </Skeleton>
    );
  if (state.kind === 'failed') {
    return (
      <FailureState
        title="활동을 불러오지 못했습니다"
        description="프로그램 정보는 정상적으로 표시되고 있습니다."
        onRetry={onRetry}
      />
    );
  }
  if (state.activities.length === 0) {
    return (
      <EmptyState
        className="break-keep"
        title="표시할 팀이 없습니다"
        description={
          compareTeams
            ? '참여 팀이 생기면 활동을 비교할 수 있습니다.'
            : '우리 팀의 활동이 집계되면 표시됩니다.'
        }
      />
    );
  }
  if (compareTeams) return <TeamComparison activities={state.activities} />;
  return (
    <div className="grid gap-6">
      {state.activities.map((activity) => (
        <SingleTeamActivity key={activity.teamId} activity={activity} />
      ))}
    </div>
  );
}

export function ActivityGraphContent({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId?: string;
}) {
  const query = useProgramActivityQuery(programId);
  const state: ActivityState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? { kind: 'failed' }
      : { kind: 'ready', activities: query.data };

  const visibleState =
    state.kind === 'ready' && teamId !== undefined
      ? {
          kind: 'ready' as const,
          activities: state.activities.filter(
            (activity) => activity.teamId === teamId,
          ),
        }
      : state;
  return (
    <ActivityPanelBody
      state={visibleState}
      onRetry={() => void query.refetch()}
      compareTeams={teamId === undefined}
    />
  );
}

export function ActivityGraphPanel({
  programId,
  viewerRole,
}: {
  readonly programId: string;
  readonly viewerRole: ViewerRole;
}) {
  if (viewerRole === null || viewerRole === 'PENDING') return null;
  return (
    <Card aria-labelledby="activity-title">
      <CardHeader>
        <CardTitle id="activity-title">활동 현황</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityGraphContent programId={programId} />
      </CardContent>
    </Card>
  );
}
