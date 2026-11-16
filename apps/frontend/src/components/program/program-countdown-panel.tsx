import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { formatClockTime, formatCountdownDate } from './program-countdown-time';

type CountdownPanelProps = {
  readonly children?: ReactNode;
  readonly 'aria-hidden'?: boolean;
};

export function CountdownPanel({
  children,
  'aria-hidden': ariaHidden,
}: CountdownPanelProps) {
  return (
    <div
      data-slot="program-countdown"
      aria-hidden={ariaHidden}
      className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
    >
      {children}
    </div>
  );
}

export function CurrentClock({ clock }: { readonly clock: Date }) {
  return (
    <div className="flex flex-col items-center text-center">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Clock aria-hidden="true" className="size-3.5" />
        현재 시간
      </p>
      <time
        data-slot="program-countdown-clock"
        dateTime={clock.toISOString()}
        className="mt-1 font-mono text-section font-bold tracking-[-0.03em] text-sidebar-foreground tabular-nums"
      >
        {formatClockTime(clock)}
      </time>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {formatCountdownDate(clock)}
      </p>
    </div>
  );
}

export function CountdownDivider() {
  return <hr className="my-3 border-sidebar-border" />;
}
