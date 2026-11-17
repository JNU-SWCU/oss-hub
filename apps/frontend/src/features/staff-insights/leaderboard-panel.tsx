'use client';

import { useState, type ReactElement } from 'react';
import { EmptyState, FilterChip, FilterChipGroup } from '@/components';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  StaffInsightsCohortLeaders,
  StaffInsightsLeaderRow,
  StaffInsightsSummary,
} from './types';

type LeaderCohort = keyof StaffInsightsCohortLeaders<unknown>;

const LEADER_COHORTS: readonly {
  readonly value: LeaderCohort;
  readonly label: string;
}[] = [
  { value: 'all', label: '전체' },
  { value: 'swMajor', label: 'SW전공' },
  { value: 'nonSw', label: '비SW전공' },
];

export function StudentsTab({
  summary,
  periodLabel,
}: {
  readonly summary: StaffInsightsSummary;
  readonly periodLabel: string;
}): ReactElement {
  const [cohort, setCohort] = useState<LeaderCohort>('all');
  const { from, to } = summary.recentWindow;
  const dataAsOf =
    summary.dataAsOf === null
      ? '수집 시각 없음'
      : `기준 ${summary.dataAsOf.toLocaleString('ko-KR')}`;

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4" aria-label="학생 순위">
      <FilterChipGroup aria-label="학생 구분">
        {LEADER_COHORTS.map((option) => (
          <FilterChip
            key={option.value}
            pressed={cohort === option.value}
            onClick={() => setCohort(option.value)}
          >
            {option.label}
          </FilterChip>
        ))}
      </FilterChipGroup>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LeaderboardCard
          title={`${periodLabel} 상위 10명`}
          description="공개 활동 기준 · Commit · PR · Issue · Repo · Star 합계"
          emptyTitle="이 기간에 활동한 학생이 없습니다"
          rows={summary.leaders.period[cohort]}
        />
        <LeaderboardCard
          title="최근 30일 상위 10명"
          description={`Commit · PR · Issue · Repo 증가분, Star 제외 · ${from.toLocaleDateString('ko-KR')}~${to.toLocaleDateString('ko-KR')} · ${dataAsOf}`}
          emptyTitle="최근 30일에 늘어난 활동이 없습니다"
          rows={summary.leaders.recent[cohort]}
        />
      </div>
    </section>
  );
}

function LeaderboardCard({
  title,
  description,
  emptyTitle,
  rows,
}: {
  readonly title: string;
  readonly description: string;
  readonly emptyTitle: string;
  readonly rows: readonly StaffInsightsLeaderRow[];
}): ReactElement {
  const maxTotal = rows.reduce((max, row) => Math.max(max, row.total), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="break-keep">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title={emptyTitle} />
        ) : (
          <ol role="list" className="grid list-none grid-cols-1 gap-4">
            {rows.map((row) => (
              <LeaderRow
                key={`${row.rank}-${row.githubLogin}`}
                row={row}
                maxTotal={maxTotal}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function LeaderRow({
  row,
  maxTotal,
}: {
  readonly row: StaffInsightsLeaderRow;
  readonly maxTotal: number;
}): ReactElement {
  const department = row.department ?? '학과 미등록';
  const share = maxTotal > 0 ? (row.total / maxTotal) * 100 : 0;

  return (
    <li className="grid grid-cols-1 gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
            row.rank <= 3
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{row.name ?? row.githubLogin}</p>
          <p className="flex min-w-0 flex-wrap gap-x-1 text-xs text-muted-foreground">
            <span className="min-w-0 max-w-full truncate">
              <span title={department}>{department}</span>
              {' ·'}
            </span>
            <span className="shrink-0">@{row.githubLogin}</span>
          </p>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums">
          {row.total}
        </span>
      </div>
      <div aria-hidden="true" className="h-2 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${share}%` }}
        />
      </div>
    </li>
  );
}
