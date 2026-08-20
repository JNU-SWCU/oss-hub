import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { insightsPageHref } from './insights-year';
import type { InsightsCut, InsightsYearScope } from './types';
export function YearLinks({
  scope,
  years,
}: {
  readonly scope: InsightsYearScope;
  readonly years: readonly number[];
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="기간">
      <YearLink
        href={insightsPageHref({ kind: 'all' })}
        current={scope.kind === 'all'}
      >
        전체
      </YearLink>
      {years.map((year) => (
        <YearLink
          key={year}
          href={insightsPageHref({ kind: 'calendar', year })}
          current={scope.kind === 'calendar' && scope.year === year}
        >
          {String(year)}
        </YearLink>
      ))}
    </div>
  );
}

export function YearLink({
  href,
  current,
  children,
}: {
  readonly href: string;
  readonly current: boolean;
  readonly children: string;
}): ReactElement {
  return (
    <Button asChild variant={current ? 'default' : 'outline'} size="sm">
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {children}
      </Link>
    </Button>
  );
}

export function CutButton({
  current,
  value,
  onCutChange,
  children,
}: {
  readonly current: InsightsCut;
  readonly value: InsightsCut;
  readonly onCutChange: (cut: InsightsCut) => void;
  readonly children: string;
}): ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      variant={current === value ? 'default' : 'outline'}
      aria-pressed={current === value}
      onClick={() => onCutChange(value)}
    >
      {children}
    </Button>
  );
}

export function MetricCard({
  title,
  sw,
  nonSw,
  extra,
}: {
  readonly title: string;
  readonly sw: number;
  readonly nonSw: number;
  readonly extra: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{extra}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">SW전공</dt>
            <dd className="text-2xl font-semibold tabular-nums">{sw}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">비SW전공</dt>
            <dd className="text-2xl font-semibold tabular-nums">{nonSw}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
