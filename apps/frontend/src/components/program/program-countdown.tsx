'use client';

import { useEffect, useState } from 'react';
import { SkeletonBlock } from '@/components/ui/skeleton';
import {
  CountdownDivider,
  CountdownPanel,
  CurrentClock,
} from './program-countdown-panel';
import {
  ProgramSchedule,
  type CountdownMilestone,
} from './program-countdown-program-schedule';
import { formatUntilDeadline, remainingUntil } from './program-countdown-time';

export { type CountdownMilestone } from './program-countdown-program-schedule';
export { formatCountdownDate, remainingUntil } from './program-countdown-time';
interface SingleCountdownProps {
  readonly mode?: 'single';
  readonly nextMilestoneLabel: string;

  readonly dueAt: string | undefined;

  readonly now?: Date;

  readonly untilLabel?: string;
}

interface ProgramScheduleCountdownProps {
  readonly mode: 'program';
  readonly milestones: readonly CountdownMilestone[];
  readonly now?: Date;
}

export type ProgramCountdownProps =
  SingleCountdownProps | ProgramScheduleCountdownProps;

export function ProgramCountdown(props: ProgramCountdownProps) {
  const nowOverride = props.now;
  const [clock, setClock] = useState<Date | null>(
    nowOverride === undefined ? null : nowOverride,
  );

  useEffect(() => {
    if (nowOverride !== undefined) return;
    setClock(new Date());
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, [nowOverride]);

  if (props.mode === 'program') {
    return clock === null ? (
      <CountdownPanel aria-hidden />
    ) : (
      <ProgramSchedule milestones={props.milestones} clock={clock} />
    );
  }

  return <SingleCountdown {...props} clock={clock} />;
}

function SingleCountdown({
  nextMilestoneLabel,
  dueAt,
  untilLabel,
  clock,
}: SingleCountdownProps & { readonly clock: Date | null }) {
  const remaining =
    clock === null || dueAt === undefined
      ? null
      : remainingUntil(new Date(dueAt), clock);
  const untilText =
    untilLabel === undefined
      ? formatUntilDeadline(nextMilestoneLabel)
      : untilLabel;

  return (
    <CountdownPanel aria-hidden={remaining === null ? true : undefined}>
      <CurrentClock clock={remaining === null ? null : clock} />
      <CountdownDivider />
      <p className="text-center text-xs text-muted-foreground">{untilText}</p>
      {remaining === null ? (
        <div className="mt-1 flex justify-center text-section">
          <SkeletonBlock className="h-lh w-32 rounded-sm" />
        </div>
      ) : (
        <div className="mt-1 flex items-baseline justify-center gap-2">
          <CountdownUnit value={remaining.days} unit="일" />
          <CountdownUnit value={remaining.hours} unit="시간" />
          <CountdownUnit value={remaining.minutes} unit="분" />
          <CountdownUnit value={remaining.seconds} unit="초" />
        </div>
      )}
    </CountdownPanel>
  );
}

type CountdownValueProps = Readonly<{ value: number; unit: string }>;

function CountdownUnit({ value, unit }: CountdownValueProps) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="text-section font-bold tracking-[-0.03em] text-primary tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}
