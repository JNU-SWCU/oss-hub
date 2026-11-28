'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components';
import { PaginationNav } from '@/components/pagination-nav';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_VIEWS,
  type AuditLogCategory,
  type AuditLogCategoryCounts,
  type AuditLogFilters,
  type AuditLogRecord,
  type AuditLogViewMode,
} from './types';
import { AuditLogDetail } from './audit-log-detail';
import { AuditLogFeed } from './audit-log-feed';
import { AuditLogFilterFields, AuditLogFilterSheet } from './audit-log-filters';
import { auditEvents, foldAuditFeed } from './audit-log-fold';
import { AUDIT_LOG_CATEGORY_LABELS, formatStamp } from './audit-log-format';
import { AuditLogTable } from './audit-log-table';

export interface AuditLogViewProps {
  readonly records: readonly AuditLogRecord[];
  readonly counts: AuditLogCategoryCounts | null;
  readonly filters: AuditLogFilters;
  readonly category: AuditLogCategory | '';
  readonly view: AuditLogViewMode;
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly fetchedAt: Date | null;
  readonly foldLogins: boolean;
  readonly selectedId: string | null;
  readonly onFilterChange: (filters: AuditLogFilters) => void;
  readonly onApply: (filters: AuditLogFilters) => void;
  readonly onCancel: () => void;
  readonly onCategoryChange: (category: AuditLogCategory | '') => void;
  readonly onViewChange: (view: AuditLogViewMode) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onSelect: (key: string | null) => void;
  readonly onSearchPerson: (login: string) => void;
}

const VIEW_LABELS: Readonly<Record<AuditLogViewMode, string>> = {
  feed: '피드',
  table: '표',
};

const TAB_CLASS = cn(
  '-mb-px rounded-none border-b-2 px-0 text-sm font-medium text-muted-foreground',
  'hover:text-foreground aria-pressed:border-b-primary aria-pressed:font-semibold aria-pressed:text-foreground',
);

const VIEW_TOGGLE_CLASS = cn(
  'hidden overflow-hidden rounded-control border border-border xl:inline-flex',
  '[&>button+button]:border-l-border',
);

function CategoryTab({
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
    <Button
      type="button"
      variant="bare"
      size="sm"
      aria-pressed={pressed}
      className={TAB_CLASS}
      onClick={onClick}
    >
      {label}
      {count === null ? null : <span className="tabular-nums">{count}</span>}
    </Button>
  );
}

export function AuditLogView(props: AuditLogViewProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { counts, records, foldLogins } = props;
  const allCount = counts
    ? AUDIT_LOG_CATEGORIES.reduce((sum, category) => sum + counts[category], 0)
    : null;
  const events = useMemo(() => auditEvents(records), [records]);
  const days = useMemo(
    () => foldAuditFeed(events, { foldLogins }),
    [events, foldLogins],
  );
  const selected =
    props.selectedId === null
      ? undefined
      : events.find((event) => event.key === props.selectedId)?.record;
  const totalPages = Math.max(1, Math.ceil(props.total / props.limit));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onApply(props.filters);
  };
  const detail = selected ? (
    <AuditLogDetail
      record={selected}
      onClose={() => props.onSelect(null)}
      onSearchPerson={props.onSearchPerson}
    />
  ) : null;
  const feed = (
    <AuditLogFeed
      days={days}
      now={props.now}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      detail={detail}
    />
  );

  return (
    <section className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="감사 로그"
        description={
          props.fetchedAt ? `${formatStamp(props.fetchedAt)} 기준` : undefined
        }
        actions={
          <>
            <div
              role="group"
              aria-label="보기 방식"
              className={VIEW_TOGGLE_CLASS}
            >
              {AUDIT_LOG_VIEWS.map((view) => (
                <Button
                  key={view}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={props.view === view}
                  className="rounded-none aria-pressed:bg-muted"
                  onClick={() => props.onViewChange(view)}
                >
                  {VIEW_LABELS[view]}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="sm:hidden"
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
              필터
            </Button>
          </>
        }
      />
      <div
        role="group"
        aria-label="분류"
        className="flex flex-wrap gap-x-6 border-b border-border"
      >
        <CategoryTab
          label="전체"
          count={allCount}
          pressed={props.category === ''}
          onClick={() => props.onCategoryChange('')}
        />
        {AUDIT_LOG_CATEGORIES.map((category) => (
          <CategoryTab
            key={category}
            label={AUDIT_LOG_CATEGORY_LABELS[category]}
            count={counts ? counts[category] : null}
            pressed={props.category === category}
            onClick={() => props.onCategoryChange(category)}
          />
        ))}
      </div>
      <form
        aria-label="필터"
        className="hidden flex-wrap items-end gap-3 sm:flex"
        onSubmit={submit}
      >
        <AuditLogFilterFields
          filters={props.filters}
          onChange={props.onApply}
          onDraft={props.onFilterChange}
          onSearch={() => props.onApply(props.filters)}
        />
      </form>
      <AuditLogFilterSheet
        open={sheetOpen}
        filters={props.filters}
        onChange={props.onFilterChange}
        onApply={() => {
          setSheetOpen(false);
          props.onApply(props.filters);
        }}
        onCancel={() => {
          setSheetOpen(false);
          props.onCancel();
        }}
      />
      {props.errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{props.errorMessage}</span>
            <Button type="button" variant="outline" onClick={props.onRetry}>
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
      ) : records.length === 0 ? (
        <EmptyState
          title="기록이 없습니다"
          description="조회 조건을 바꿔 보세요."
        />
      ) : (
        <div
          className={cn(
            'grid min-w-0 items-start gap-4',
            selected &&
              props.view === 'table' &&
              'xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
          )}
        >
          <div className="min-w-0">
            {props.view === 'table' ? (
              <>
                <div className="hidden xl:block">
                  <AuditLogTable
                    events={events}
                    now={props.now}
                    selectedId={props.selectedId}
                    onSelect={props.onSelect}
                  />
                </div>
                <div className="xl:hidden">{feed}</div>
              </>
            ) : (
              feed
            )}
          </div>
          {detail && props.view === 'table' ? (
            <div className="hidden min-w-0 xl:sticky xl:top-4 xl:block">
              {detail}
            </div>
          ) : null}
        </div>
      )}
      <PaginationNav
        page={props.page}
        totalPages={totalPages}
        onPageChange={props.onPageChange}
        ariaLabel="감사 로그 페이지"
        isLoading={props.isLoading}
      />
    </section>
  );
}
