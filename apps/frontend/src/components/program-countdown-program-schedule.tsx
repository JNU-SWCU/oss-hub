import {
  formatClock,
  formatCountdownDate,
  formatCountdownDateTime,
  formatCountdownListDate,
  remainingUntil,
} from './program-countdown-time';

export interface CountdownMilestone {
  readonly label: string;
  readonly dueAt: string;
}

type ParsedCountdownMilestone = CountdownMilestone & {
  readonly dueDate: Date;
  readonly sourceIndex: number;
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

function activeMilestones(
  milestones: readonly CountdownMilestone[],
  now: Date,
): readonly ParsedCountdownMilestone[] {
  const nowTime = now.getTime();
  return milestones
    .map((milestone, sourceIndex) => {
      const dueDate = new Date(milestone.dueAt);
      if (Number.isNaN(dueDate.getTime())) {
        throw new InvalidCountdownMilestoneDateError(milestone);
      }
      return { ...milestone, dueDate, sourceIndex };
    })
    .filter(({ dueDate }) => dueDate.getTime() > nowTime)
    .sort(
      (left, right) =>
        left.dueDate.getTime() - right.dueDate.getTime() ||
        left.sourceIndex - right.sourceIndex,
    );
}

export function ProgramSchedule({ milestones, clock }: ProgramScheduleProps) {
  let active: readonly ParsedCountdownMilestone[];
  try {
    active = activeMilestones(milestones, clock);
  } catch (error) {
    if (error instanceof InvalidCountdownMilestoneDateError) {
      return <InvalidProgramSchedule />;
    }
    throw error;
  }
  const nearest = active[0];

  return (
    <div
      data-slot="program-countdown"
      className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
    >
      <p className="text-xs text-muted-foreground">현재 시각</p>
      <p className="text-sm font-semibold text-sidebar-foreground tabular-nums">
        {formatClock(clock)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatCountdownDate(clock)}
      </p>
      {nearest === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">
          마감 일정이 종료되었습니다.
        </p>
      ) : (
        <ActiveProgramSchedule
          active={active}
          nearest={nearest}
          clock={clock}
        />
      )}
    </div>
  );
}

function InvalidProgramSchedule() {
  return (
    <div
      data-slot="program-countdown"
      className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
    >
      <p role="alert" className="text-sm text-muted-foreground">
        마감 일정을 표시할 수 없습니다.
      </p>
    </div>
  );
}

type ActiveProgramScheduleProps = {
  readonly active: readonly ParsedCountdownMilestone[];
  readonly nearest: ParsedCountdownMilestone;
  readonly clock: Date;
};

function ActiveProgramSchedule({
  active,
  nearest,
  clock,
}: ActiveProgramScheduleProps) {
  const remaining = remainingUntil(nearest.dueDate, clock);

  return (
    <>
      <p className="mt-3 min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
        {nearest.label}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-1">
        <CountdownCell value={remaining.days} unit="일" />
        <CountdownCell value={remaining.hours} unit="시간" />
        <CountdownCell value={remaining.minutes} unit="분" />
        <CountdownCell value={remaining.seconds} unit="초" />
      </div>
      <time
        dateTime={nearest.dueAt}
        className="mt-2 block whitespace-nowrap text-xs font-medium text-sidebar-foreground tabular-nums"
      >
        {formatCountdownDateTime(nearest.dueDate)}
      </time>
      <ul className="mt-3 space-y-1">
        {active.map((milestone) => (
          <li
            key={`${milestone.dueAt}:${milestone.label}:${milestone.sourceIndex}`}
            className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground"
          >
            <span className="min-w-0 truncate">{milestone.label}</span>
            <span aria-hidden className="shrink-0">
              —
            </span>
            <time
              dateTime={milestone.dueAt}
              className="shrink-0 whitespace-nowrap tabular-nums"
            >
              {formatCountdownListDate(milestone.dueDate)}
            </time>
          </li>
        ))}
      </ul>
    </>
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
