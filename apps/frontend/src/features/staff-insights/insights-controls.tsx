import { FilterChip } from '@/components';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
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
    <div className="flex flex-wrap gap-2">
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
    <Button
      asChild
      variant={current ? 'default' : 'outline'}
      size="sm"
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
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
  /*
   * 고른 값을 주 행동 색(`default`)으로 칠하지 않는다. 화면에서 가장 눈에 띄는
   * 것이 「지금 고른 것」이 되면 정작 눌러야 할 주 행동이 묻힌다(R-34).
   * 거르는 선택은 FilterChip 이 맡는다 — 눌림을 표면이 아니라 aria-pressed 와
   * 칩 변형으로 말하고, 화살표 좌우로 칩 사이를 옮길 수 있다.
   */
  return (
    <FilterChip
      pressed={current === value}
      onClick={() => onCutChange(value)}
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </FilterChip>
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
  readonly extra: ReactNode;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="break-keep">{extra}</CardDescription>
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
