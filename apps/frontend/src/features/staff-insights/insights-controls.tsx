import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { insightsPageHref } from './insights-year';
import {
  INSIGHTS_VIEWS,
  type InsightsView,
  type StaffInsightsUrlState,
} from './types';

const VIEW_LABELS: Readonly<Record<InsightsView, string>> = {
  students: '학생',
  groups: '학과·전공',
  programs: '프로그램',
};

const VIEW_TAB_CLASS = cn(
  '-mb-px border-b-2 border-transparent py-2 text-sm font-medium text-muted-foreground',
  'outline-none transition-colors hover:text-foreground',
  'focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50',
  'aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-foreground',
);

export function YearLinks({
  state: { scope, view },
  years,
}: {
  readonly state: StaffInsightsUrlState;
  readonly years: readonly number[];
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleLink
        href={insightsPageHref({ scope: { kind: 'all' }, view })}
        current={scope.kind === 'all'}
      >
        전체
      </ToggleLink>
      {years.map((year) => (
        <ToggleLink
          key={year}
          href={insightsPageHref({ scope: { kind: 'calendar', year }, view })}
          current={scope.kind === 'calendar' && scope.year === year}
        >
          {String(year)}
        </ToggleLink>
      ))}
    </div>
  );
}

function ToggleLink({
  href,
  current,
  children,
}: {
  readonly href: string;
  readonly current: boolean;
  readonly children: string;
}): ReactElement {
  return (
    <Button asChild variant="toggle" size="sm">
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {children}
      </Link>
    </Button>
  );
}

export function ViewTabs({
  state,
}: {
  readonly state: StaffInsightsUrlState;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label="인사이트 보기"
      className="flex flex-wrap gap-x-6 border-b border-border"
    >
      {INSIGHTS_VIEWS.map((view) => (
        <Link
          key={view}
          href={insightsPageHref({ scope: state.scope, view })}
          aria-current={state.view === view ? 'page' : undefined}
          className={VIEW_TAB_CLASS}
        >
          {VIEW_LABELS[view]}
        </Link>
      ))}
    </div>
  );
}
