'use client';

import { useState, type FormEvent } from 'react';
import {
  EmptyState,
  FilterChip,
  FilterChipGroup,
  PageHeader,
} from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  AUDIT_LOG_ACTION_LABELS,
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_CATEGORIES,
  type AuditLogCategory,
  type AuditLogCategoryCounts,
  type AuditLogFilters,
  type AuditLogRecord,
  type AuditLogViewMode,
} from './types';
import { AUDIT_LOG_CATEGORY_LABELS } from './audit-log-format';
import { AuditLogFeed } from './audit-log-feed';
import { AuditLogTable } from './audit-log-table';

export interface AuditLogViewProps {
  readonly records: readonly AuditLogRecord[];
  readonly counts: AuditLogCategoryCounts | null;
  readonly filters: AuditLogFilters;
  readonly activeFilterCount: number;
  readonly category: AuditLogCategory | '';
  readonly view: AuditLogViewMode;
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly onFilterChange: (filters: AuditLogFilters) => void;
  readonly onSearch: () => void;
  readonly onReset: () => void;
  readonly onCategoryChange: (category: AuditLogCategory | '') => void;
  readonly onViewChange: (view: AuditLogViewMode) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

const CATEGORY_CHIPS_CLASS = cn(
  'min-w-0 flex-1 flex-nowrap overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap',
  '[mask-image:linear-gradient(to_right,black_85%,transparent)]',
  'sm:flex-wrap sm:overflow-visible sm:[mask-image:none]',
);

const VIEW_LABELS: Readonly<Record<AuditLogViewMode, string>> = {
  feed: '피드',
  table: '표',
};

function CategoryChip({
  label,
  count,
  pressed,
  onClick,
}: {
  readonly label: string;
  readonly count: number | null;
  readonly pressed: boolean;
  readonly onClick: () => void;
}) {
  return (
    <FilterChip pressed={pressed} onClick={onClick}>
      {label}
      {count === null ? null : (
        <span className="ml-1 text-xs tabular-nums opacity-70">{count}</span>
      )}
    </FilterChip>
  );
}

export function AuditLogView(props: AuditLogViewProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));
  const counts = props.counts;
  const allCount = counts
    ? AUDIT_LOG_CATEGORIES.reduce((sum, category) => sum + counts[category], 0)
    : null;

  const update = (key: keyof AuditLogFilters, value: string) =>
    props.onFilterChange({ ...props.filters, [key]: value });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="감사 로그"
        actions={
          <FilterChipGroup aria-label="보기 방식">
            {(['feed', 'table'] as const).map((view) => (
              <FilterChip
                key={view}
                pressed={props.view === view}
                onClick={() => props.onViewChange(view)}
              >
                {VIEW_LABELS[view]}
              </FilterChip>
            ))}
          </FilterChipGroup>
        }
      />
      <div className="flex min-w-0 items-center gap-2">
        <FilterChipGroup aria-label="분류" className={CATEGORY_CHIPS_CLASS}>
          <CategoryChip
            label="전체"
            count={allCount}
            pressed={props.category === ''}
            onClick={() => props.onCategoryChange('')}
          />
          {AUDIT_LOG_CATEGORIES.map((category) => (
            <CategoryChip
              key={category}
              label={AUDIT_LOG_CATEGORY_LABELS[category]}
              count={counts ? counts[category] : null}
              pressed={props.category === category}
              onClick={() => props.onCategoryChange(category)}
            />
          ))}
        </FilterChipGroup>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0 sm:hidden"
          aria-expanded={filtersOpen}
          aria-controls="audit-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          필터
          {props.activeFilterCount > 0 ? (
            <span className="ml-1 tabular-nums">{props.activeFilterCount}</span>
          ) : null}
        </Button>
      </div>
      <form
        id="audit-filters"
        aria-label="필터"
        className={cn(
          filtersOpen ? 'grid' : 'hidden',
          'w-full min-w-0 gap-4 rounded-lg border border-border p-4 sm:grid sm:grid-cols-2 xl:grid-cols-5 xl:items-end',
        )}
        onSubmit={submit}
      >
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-q" className="text-sm font-medium">
            검색
          </label>
          <Input
            id="audit-q"
            className="min-h-11 w-full min-w-0"
            value={props.filters.q}
            onChange={(event) => update('q', event.target.value)}
            placeholder="이름 또는 GitHub 아이디"
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-action" className="text-sm font-medium">
            작업 종류
          </label>
          <select
            id="audit-action"
            className={cn(
              'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50',
              'min-h-11 w-full min-w-0 rounded-md border px-3 text-sm outline-none',
              'focus-visible:ring-[3px]',
            )}
            value={props.filters.action}
            onChange={(event) => update('action', event.target.value)}
          >
            <option value="">전체</option>
            {AUDIT_LOG_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_LOG_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-from" className="text-sm font-medium">
            시작일
          </label>
          <Input
            id="audit-from"
            className="min-h-11 w-full min-w-0"
            type="date"
            value={props.filters.from}
            onChange={(event) => update('from', event.target.value)}
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-to" className="text-sm font-medium">
            종료일
          </label>
          <Input
            id="audit-to"
            className="min-h-11 w-full min-w-0"
            type="date"
            value={props.filters.to}
            onChange={(event) => update('to', event.target.value)}
          />
        </div>
        <div className="flex w-full min-w-0 gap-2">
          <Button type="submit" className="min-h-11 min-w-0 flex-1">
            조회
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 min-w-0 flex-1"
            onClick={props.onReset}
          >
            초기화
          </Button>
        </div>
      </form>
      {props.errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{props.errorMessage}</span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={props.onRetry}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {props.isLoading ? (
        <Skeleton
          label="감사 로그를 불러오는 중"
          className="flex flex-col gap-2 py-2"
        >
          {[0, 1, 2].map((row) => (
            <SkeletonBlock key={row} className="h-4 w-full rounded" />
          ))}
        </Skeleton>
      ) : props.records.length === 0 ? (
        <EmptyState
          title="기록이 없습니다"
          description="조회 조건을 바꿔 보세요."
        />
      ) : props.view === 'table' ? (
        <AuditLogTable records={props.records} />
      ) : (
        <AuditLogFeed records={props.records} now={props.now} />
      )}
      <div className="flex items-center justify-end gap-3 text-sm">
        <span>총 {props.total}건</span>
        <span>
          {props.page} / {lastPage} 페이지
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={props.page <= 1 || props.isLoading}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          이전
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={props.page >= lastPage || props.isLoading}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          다음
        </Button>
      </div>
    </section>
  );
}
