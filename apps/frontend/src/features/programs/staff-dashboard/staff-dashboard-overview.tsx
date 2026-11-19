import {
  CalendarX,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { DataTable, type DataTableColumn } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { programEditHref } from '@/lib/program-route';
import { cn } from '@/lib/utils';
import { milestoneCountdown } from '../catalog/program-detail-format';
import type {
  StaffDashboardMilestoneSummary,
  StaffDashboardProgramSummary,
  StaffDashboardSort,
  StaffDashboardSortDirection,
} from './dto';
import { getStaffProgramRecruitmentState } from './staff-dashboard-status';

export interface StaffDashboardOrder {
  readonly sort: StaffDashboardSort;
  readonly direction: StaffDashboardSortDirection;
}

interface StaffDashboardOverviewProps {
  readonly programs: readonly StaffDashboardProgramSummary[];
  readonly totalPrograms?: number;
  readonly now: Date;
  readonly order?: StaffDashboardOrder;
  readonly onSortChange: (order: StaffDashboardOrder) => void;
}

interface CurrentMilestone {
  readonly schedule: readonly StaffDashboardMilestoneSummary[];
  readonly index: number;
}

interface SubmissionProgress {
  readonly submitted: number;
  readonly total: number;
}

interface DashboardRow {
  readonly program: StaffDashboardProgramSummary;
  readonly stageName: string | null;
  readonly current: CurrentMilestone | null;
  readonly dueAt: string | null;
  readonly submission: SubmissionProgress | null;
}

const INITIAL_DIRECTIONS = {
  name: 'asc',
  deadline: 'asc',
  submission: 'asc',
  pending: 'desc',
} as const satisfies Record<StaffDashboardSort, StaffDashboardSortDirection>;

export const DEFAULT_STAFF_DASHBOARD_ORDER: StaffDashboardOrder = {
  sort: 'pending',
  direction: INITIAL_DIRECTIONS.pending,
};

const STAGE_STATUS_LABELS = {
  upcoming: '모집 전',
  recruiting: '모집',
  in_progress: null,
  ended: '종료',
} as const;

const HEAD_CLASS = 'px-4 py-3';
const CELL_CLASS = 'px-4 py-2.5';
const RIGHT_CELL_CLASS = `${CELL_CLASS} text-right`;
const EMPTY_CELL = (
  <span aria-hidden="true" className="text-muted-foreground">
    —
  </span>
);

function dashboardRow(
  program: StaffDashboardProgramSummary,
  now: Date,
): DashboardRow {
  const state = getStaffProgramRecruitmentState(program, now);
  const schedule =
    state === 'in_progress'
      ? [...program.milestones].sort(
          (left, right) =>
            Date.parse(left.startAt) - Date.parse(right.startAt) ||
            Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
            (left.id < right.id ? -1 : Number(left.id > right.id)),
        )
      : [];
  const index = schedule.findLastIndex(
    (item) => Date.parse(item.startAt) <= now.getTime(),
  );
  const current = schedule[index];
  const submitted = current?.submittedTeams;
  const total = current?.totalTeams;

  return {
    program,
    stageName: current?.name ?? STAGE_STATUS_LABELS[state],
    current: current === undefined ? null : { schedule, index },
    dueAt:
      state === 'recruiting'
        ? program.applicationPeriod.endsAt
        : (current?.dueAt ?? null),
    submission:
      submitted != null && total != null && total > 0
        ? { submitted, total }
        : null,
  };
}

export function StaffDashboardOverview({
  programs,
  totalPrograms = programs.length,
  now,
  order = DEFAULT_STAFF_DASHBOARD_ORDER,
  onSortChange,
}: StaffDashboardOverviewProps): ReactElement {
  const rows = programs.map((program) => dashboardRow(program, now));
  const columns: DataTableColumn<DashboardRow>[] = [
    {
      id: 'name',
      ...sortHeader('프로그램', 'name', order, onSortChange),
      headClassName: `${HEAD_CLASS} w-[29%]`,
      cell: ({ program }) => <ProgramLink program={program} />,
      cellClassName: `${CELL_CLASS} text-table tracking-normal`,
      rowHeader: true,
    },
    {
      id: 'stage',
      header: '현재 단계',
      headClassName: `${HEAD_CLASS} w-[14%]`,
      cell: (row) => <CurrentStage row={row} now={now} fallback={EMPTY_CELL} />,
      cellClassName: CELL_CLASS,
    },
    {
      id: 'deadline',
      ...sortHeader('단계 마감', 'deadline', order, onSortChange),
      headClassName: `${HEAD_CLASS} w-[22%]`,
      cell: ({ dueAt }) =>
        dueAt === null ? EMPTY_CELL : <StageDeadline dueAt={dueAt} now={now} />,
      cellClassName: CELL_CLASS,
    },
    {
      id: 'submission',
      ...sortHeader('제출', 'submission', order, onSortChange),
      headClassName: `${HEAD_CLASS} w-[12%] text-right`,
      cell: ({ submission }) =>
        submission === null ? (
          EMPTY_CELL
        ) : (
          <SubmissionBar progress={submission} />
        ),
      cellClassName: RIGHT_CELL_CLASS,
    },
    {
      id: 'pending',
      ...sortHeader('처리 대기', 'pending', order, onSortChange),
      headClassName: `${HEAD_CLASS} text-right`,
      cell: ({ program }) => (
        <PendingWork program={program} fallback={EMPTY_CELL} />
      ),
      cellClassName: RIGHT_CELL_CLASS,
    },
  ];

  return (
    <TooltipProvider>
      <div className="min-w-0 overflow-hidden rounded-card border border-border">
        <DataTable
          scrollRegionLabel="프로그램 운영 현황 표"
          columns={columns}
          data={rows}
          rowKey={({ program }) => program.id}
          caption={`총 ${totalPrograms}개 프로그램 운영 현황`}
          hideCaption
          className="hidden lg:block [&_table]:table-fixed"
        />
        <ul
          aria-label="프로그램 운영 현황"
          className="divide-y divide-border/60 text-table lg:hidden"
        >
          {rows.map((row) => (
            <MobileProgramRow key={row.program.id} row={row} now={now} />
          ))}
        </ul>
      </div>
    </TooltipProvider>
  );
}

function sortHeader(
  label: string,
  sort: StaffDashboardSort,
  order: StaffDashboardOrder,
  onSortChange: StaffDashboardOverviewProps['onSortChange'],
): Pick<DataTableColumn<DashboardRow>, 'header' | 'headProps'> {
  const direction = sort === order.sort ? order.direction : null;
  const Arrow = direction === 'asc' ? ChevronUp : ChevronDown;

  return {
    header: (
      <Button
        type="button"
        variant="bare"
        size="content"
        className="inline-flex items-center gap-1 rounded-sm font-semibold hover:underline"
        onClick={() =>
          onSortChange({
            sort,
            direction:
              direction === null
                ? INITIAL_DIRECTIONS[sort]
                : direction === 'asc'
                  ? 'desc'
                  : 'asc',
          })
        }
      >
        {label}
        {direction !== null ? (
          <Arrow aria-hidden="true" className="size-3" />
        ) : null}
      </Button>
    ),
    headProps:
      direction === null
        ? undefined
        : { 'aria-sort': direction === 'asc' ? 'ascending' : 'descending' },
  };
}

function ProgramLink({
  program,
}: {
  readonly program: StaffDashboardProgramSummary;
}): ReactElement {
  return (
    <Link
      href={programEditHref(program.id)}
      aria-label={`${program.name} 편집`}
      className="block min-w-0 truncate rounded-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      {program.name}
    </Link>
  );
}

function CurrentStage({
  row,
  now,
  fallback,
}: {
  readonly row: DashboardRow;
  readonly now: Date;
  readonly fallback?: ReactElement;
}): ReactElement | null {
  if (row.stageName === null) return fallback ?? null;
  if (row.current === null) return <span>{row.stageName}</span>;
  const { schedule, index } = row.current;
  const stages = schedule.map((milestone, position) => {
    const status =
      position === index
        ? ' · 진행 중'
        : Date.parse(milestone.dueAt) < now.getTime()
          ? ' · 마감'
          : '';
    return `${position + 1} ${milestone.name}${status}`;
  });

  return (
    <DashboardTooltip
      label={stages.join(' / ')}
      detail={stages.join('\n')}
      className="inline-flex max-w-full min-w-0 flex-col items-start gap-1 text-left"
    >
      <span className="max-w-full truncate">{row.stageName}</span>
      <span
        aria-hidden="true"
        className="flex max-w-24 gap-0.5 self-center overflow-hidden"
      >
        {schedule.map(({ id }, position) => (
          <span
            key={id}
            className={cn(
              'h-1.5 w-3 rounded-full',
              position <= index ? 'bg-primary' : 'bg-muted',
            )}
          />
        ))}
      </span>
    </DashboardTooltip>
  );
}

const SEOUL_DEADLINE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function deadlineParts(date: Date) {
  const parts = Object.fromEntries(
    SEOUL_DEADLINE_FORMAT.formatToParts(date).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  const day =
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) /
    86_400_000;
  return { parts, day };
}

function StageDeadline({
  dueAt,
  now,
}: {
  readonly dueAt: string;
  readonly now: Date;
}): ReactElement {
  const due = new Date(dueAt);
  const {
    parts: { year, month, day, weekday, hour, minute },
    day: dueDay,
  } = deadlineParts(due);
  const { label, tone } = milestoneCountdown(
    dueDay - deadlineParts(now).day,
    due < now,
  );

  return (
    <DashboardTooltip
      detail={`${year}년 ${month}월 ${day}일 (${weekday}) ${hour}:${minute} 마감`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums',
        tone === 'closed' && 'text-muted-foreground',
      )}
    >
      {tone === 'closed' ? (
        <CalendarX aria-hidden="true" className="size-3.5" />
      ) : null}
      <time dateTime={dueAt}>
        {month}.{day}
        <span className="hidden sm:inline"> ({weekday})</span>
      </time>{' '}
      <span
        className={cn(
          tone === 'soon' && 'font-semibold text-status-pending-fg',
          tone === 'ahead' && 'font-semibold text-muted-foreground',
        )}
      >
        {label === 'D-Day' ? 'D-day' : label}
      </span>
    </DashboardTooltip>
  );
}

function SubmissionBar({
  progress,
}: {
  readonly progress: SubmissionProgress;
}): ReactElement {
  const { submitted, total } = progress;
  const label = `제출 ${submitted}팀 · 미제출 ${total - submitted}팀 (전체 ${total}팀)`;

  return (
    <DashboardTooltip
      label={label}
      detail={label}
      className="inline-flex h-6 w-16 shrink-0 items-center"
    >
      <span
        aria-hidden="true"
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <span
          className="h-full rounded-full bg-primary"
          style={{ width: `${(submitted / total) * 100}%` }}
        />
      </span>
    </DashboardTooltip>
  );
}

function PendingWork({
  program,
  fallback,
}: {
  readonly program: StaffDashboardProgramSummary;
  readonly fallback?: ReactElement;
}): ReactElement | null {
  const reviews = program.submissions.submitted;
  const applications = program.applications.pendingApproval;
  if (reviews === 0 && applications === 0) return fallback ?? null;

  return (
    <span className="inline-flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1 text-small font-semibold tabular-nums">
      {reviews > 0 ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <ClipboardCheck aria-hidden="true" className="size-4" /> 검토{' '}
          {reviews}
        </span>
      ) : null}
      {applications > 0 ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <UserPlus aria-hidden="true" className="size-4" /> 신청 {applications}
        </span>
      ) : null}
    </span>
  );
}

function MobileProgramRow({
  row,
  now,
}: {
  readonly row: DashboardRow;
  readonly now: Date;
}): ReactElement {
  const separator = <span aria-hidden="true">·</span>;

  return (
    <li className="grid min-w-0 gap-1.5 px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <ProgramLink program={row.program} />
        <PendingWork program={row.program} />
      </div>
      {row.stageName !== null || row.dueAt !== null ? (
        <div className="flex min-w-0 items-center gap-2 text-small">
          <CurrentStage row={row} now={now} />
          {row.dueAt !== null ? (
            <>
              {row.stageName !== null ? separator : null}
              <StageDeadline dueAt={row.dueAt} now={now} />
            </>
          ) : null}
          {row.submission !== null ? (
            <>
              {separator}
              <SubmissionBar progress={row.submission} />
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DashboardTooltip({
  label,
  detail,
  className,
  children,
}: {
  readonly label?: string;
  readonly detail: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const openBeforeTap = useRef<boolean | null>(null);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="bare"
          size="content"
          aria-label={label}
          {...(label === undefined ? {} : { 'aria-describedby': undefined })}
          className={cn('rounded-sm', className)}
          onPointerDown={(event) => {
            openBeforeTap.current = event.pointerType === 'touch' ? open : null;
          }}
          onPointerCancel={() => {
            openBeforeTap.current = null;
          }}
          onClick={(event) => {
            const wasOpen = openBeforeTap.current;
            openBeforeTap.current = null;
            if (wasOpen === null) return;
            event.preventDefault();
            setOpen(!wasOpen);
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        collisionPadding={12}
        className="max-w-[min(20rem,calc(100vw_-_1.5rem))] whitespace-pre-line [overflow-wrap:anywhere]"
      >
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}
