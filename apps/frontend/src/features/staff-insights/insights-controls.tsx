'use client';

import { Info } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  insightsPageHref,
  parseInsightsYearSearchParam,
} from './insights-year';
import {
  INSIGHTS_VIEWS,
  type InsightsView,
  type InsightsYearScope,
  type StaffInsightsUrlState,
} from './types';

const VIEW_LABELS: Readonly<Record<InsightsView, string>> = {
  students: '순위',
  finder: '학생 찾기',
  groups: '학과·전공',
  programs: '프로그램',
};

const VIEW_TAB_CLASS = cn(
  '-mb-px border-b-2 border-transparent py-2 text-sm font-medium text-muted-foreground',
  'outline-none transition-colors hover:text-foreground',
  'focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50',
  'aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-foreground',
);

export function FilterField({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function PeriodSelect({
  scope,
  years,
  onChange,
}: {
  readonly scope: InsightsYearScope;
  readonly years: readonly number[];
  readonly onChange: (scope: InsightsYearScope) => void;
}): ReactElement {
  const options = [
    ...new Set(scope.kind === 'calendar' ? [...years, scope.year] : years),
  ].sort((left, right) => right - left);

  return (
    <FilterField id="insights-period" label="기간">
      <Select
        id="insights-period"
        className="w-auto"
        value={scope.kind === 'all' ? 'all' : String(scope.year)}
        onChange={(event) =>
          onChange(parseInsightsYearSearchParam(event.currentTarget.value))
        }
      >
        <option value="all">전체</option>
        {options.map((year) => (
          <option key={year} value={year}>{`${year}년`}</option>
        ))}
      </Select>
    </FilterField>
  );
}

export function MetricHint({
  label,
  description,
}: {
  readonly label: string;
  readonly description: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const openAtPress = useRef(false);
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          onPointerDown={(event) => {
            openAtPress.current = open;
            event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            setOpen(event.detail === 0 || !openAtPress.current);
          }}
        >
          <Button
            type="button"
            variant="bare"
            size="content"
            aria-label={`${label} 설명`}
            className="inline-flex cursor-help"
          >
            <Info aria-hidden="true" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          collisionPadding={12}
          className="max-w-64 text-wrap break-keep"
        >
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ViewTabs({
  state,
}: {
  readonly state: StaffInsightsUrlState;
}): ReactElement {
  return (
    <nav
      aria-label="인사이트 보기"
      className="flex flex-wrap gap-x-4 border-b border-border sm:gap-x-6"
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
    </nav>
  );
}
