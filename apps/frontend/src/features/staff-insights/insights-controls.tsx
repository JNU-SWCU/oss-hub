import { FilterChipGroup } from '@/components';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
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
    <FilterChipGroup aria-label="인사이트 보기">
      {INSIGHTS_VIEWS.map((view) => (
        <ToggleLink
          key={view}
          href={insightsPageHref({ scope: state.scope, view })}
          current={state.view === view}
        >
          {VIEW_LABELS[view]}
        </ToggleLink>
      ))}
    </FilterChipGroup>
  );
}
