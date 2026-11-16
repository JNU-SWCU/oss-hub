'use client';

import { useEffect, useState } from 'react';
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

  readonly dueAt: string;

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

  if (clock === null) {
    return <CountdownPanel aria-hidden />;
  }

  if (props.mode === 'program') {
    return <ProgramSchedule milestones={props.milestones} clock={clock} />;
  }

  return <SingleCountdown {...props} clock={clock} />;
}

function SingleCountdown({
  nextMilestoneLabel,
  dueAt,
  untilLabel,
  clock,
}: SingleCountdownProps & { readonly clock: Date }) {
  const remaining = remainingUntil(new Date(dueAt), clock);
  const untilText =
    untilLabel === undefined
      ? formatUntilDeadline(nextMilestoneLabel)
      : untilLabel;

  return (
    <CountdownPanel>
      <CurrentClock clock={clock} />
      <CountdownDivider />
      <p className="text-center text-xs text-muted-foreground">{untilText}</p>
      <div className="mt-1 flex items-baseline justify-center gap-2">
        <CountdownUnit value={remaining.days} unit="일" />
        <CountdownUnit value={remaining.hours} unit="시간" />
        <CountdownUnit value={remaining.minutes} unit="분" />
        <CountdownUnit value={remaining.seconds} unit="초" />
      </div>
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
