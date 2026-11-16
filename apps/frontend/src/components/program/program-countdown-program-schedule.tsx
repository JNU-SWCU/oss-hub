import { cn } from '@/lib/utils';
import {
  CountdownDivider,
  CountdownPanel,
  CurrentClock,
} from './program-countdown-panel';
import {
  formatDueDateTime,
  formatScheduleDateTime,
  formatUntilDeadline,
  remainingUntil,
} from './program-countdown-time';

export interface CountdownMilestone {
  readonly label: string;
  readonly dueAt: string;
}

type ScheduleMilestoneState = 'past' | 'nearest' | 'future';

type ScheduleRow = CountdownMilestone & {
  readonly dueDate: Date;
  readonly sourceIndex: number;
  readonly state: ScheduleMilestoneState;
};

type ProgramScheduleProps = {
  readonly milestones: readonly CountdownMilestone[];
  readonly clock: Date;
};

class InvalidCountdownMilestoneDateError extends RangeError {
  readonly name = 'InvalidCountdownMilestoneDateError';

  constructor(milestone: CountdownMilestone) {
    super(
      `프로그램 마감 "${milestone.label}"의 dueAt이 유효하지 않습니다: ${milestone.dueAt}`,
    );
  }
}

function scheduleRows(
  milestones: readonly CountdownMilestone[],
  now: Date,
): readonly ScheduleRow[] {
  const nowTime = now.getTime();
  const sorted = milestones
    .map((milestone, sourceIndex) => {
      const dueDate = new Date(milestone.dueAt);
      if (Number.isNaN(dueDate.getTime())) {
        throw new InvalidCountdownMilestoneDateError(milestone);
      }
      return { ...milestone, dueDate, sourceIndex };
    })
    .sort(
      (left, right) =>
        left.dueDate.getTime() - right.dueDate.getTime() ||
        left.sourceIndex - right.sourceIndex,
    );
  const nearestIndex = sorted.findIndex(
    ({ dueDate }) => dueDate.getTime() > nowTime,
  );
  return sorted.map((row, index) => ({
    ...row,
    state:
      nearestIndex === -1 || index < nearestIndex
        ? 'past'
        : index === nearestIndex
          ? 'nearest'
          : 'future',
  }));
}

export function ProgramSchedule({ milestones, clock }: ProgramScheduleProps) {
  let rows: readonly ScheduleRow[];
  try {
    rows = scheduleRows(milestones, clock);
  } catch (error) {
    if (error instanceof InvalidCountdownMilestoneDateError) {
      return <InvalidProgramSchedule />;
    }
    throw error;
  }
  const nearest = rows.find((row) => row.state === 'nearest');

  return (
    <CountdownPanel>
      <CurrentClock clock={clock} />
      <CountdownDivider />
      {nearest === undefined ? (
        <p className="text-center text-sm text-muted-foreground">
          마감 일정이 종료되었습니다.
        </p>
      ) : (
        <NearestCountdown nearest={nearest} clock={clock} />
      )}
      {rows.length > 0 ? (
        <>
          <CountdownDivider />
          <ScheduleList rows={rows} />
        </>
      ) : null}
    </CountdownPanel>
  );
}

function InvalidProgramSchedule() {
  return (
    <CountdownPanel>
      <p role="alert" className="text-sm text-muted-foreground">
        마감 일정을 표시할 수 없습니다.
      </p>
    </CountdownPanel>
  );
}

type NearestCountdownProps = {
  readonly nearest: ScheduleRow;
  readonly clock: Date;
};

function NearestCountdown({ nearest, clock }: NearestCountdownProps) {
  const remaining = remainingUntil(nearest.dueDate, clock);

  return (
    <div className="text-center">
      <p className="line-clamp-2 text-xs font-medium break-keep text-muted-foreground">
        {formatUntilDeadline(nearest.label)}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <CountdownCell value={remaining.days} unit="일" />
        <CountdownCell value={remaining.hours} unit="시" />
        <CountdownCell value={remaining.minutes} unit="분" />
        <CountdownCell value={remaining.seconds} unit="초" />
      </div>
      <time
        dateTime={nearest.dueAt}
        className="mt-2 block whitespace-nowrap text-xs font-medium text-sidebar-foreground tabular-nums"
      >
        {formatDueDateTime(nearest.dueDate)} 마감
      </time>
    </div>
  );
}

const SCHEDULE_ROW_CLASS: Readonly<Record<ScheduleMilestoneState, string>> = {
  past: 'line-through text-muted-foreground',
  nearest: 'font-semibold text-primary',
  future: 'text-sidebar-foreground',
};

function ScheduleList({ rows }: { readonly rows: readonly ScheduleRow[] }) {
  return (
    <ol aria-label="마감 일정" className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={`${row.dueAt}:${row.label}:${row.sourceIndex}`}
          data-schedule-state={row.state}
          className={cn(
            'flex items-baseline justify-between gap-2 text-xs',
            SCHEDULE_ROW_CLASS[row.state],
          )}
        >
          <span className="min-w-0 truncate">{row.label}</span>
          <time
            dateTime={row.dueAt}
            className={cn(
              'shrink-0 font-mono whitespace-nowrap tabular-nums',
              row.state === 'past' && 'text-destructive line-through',
            )}
          >
            {formatScheduleDateTime(row.dueDate)}
          </time>
        </li>
      ))}
    </ol>
  );
}

type CountdownCellProps = Readonly<{ value: number; unit: string }>;

function CountdownCell({ value, unit }: CountdownCellProps) {
  return (
    <span
      data-countdown-cell
      className="flex min-w-0 flex-col items-center rounded-md bg-muted/50 px-1 py-2 text-center"
    >
      <span className="text-xl font-bold text-primary tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}
