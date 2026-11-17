'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useAuditLogUrlState } from './audit-log-url-state';
import { useAuditLogQuery } from './queries';
import { AuditLogView } from './audit-log-view';
import type { AuditLogFilters } from './types';

const AUDIT_LOG_PAGE_LIMIT = 20;
const EMPTY_FILTERS: AuditLogFilters = { q: '', action: '', from: '', to: '' };

export function AuditLogScreen() {
  const { state, navigate } = useAuditLogUrlState();
  const applied: AuditLogFilters = {
    q: state.q,
    action: state.action,
    from: state.from,
    to: state.to,
  };
  const source = JSON.stringify(applied);
  const [draft, setDraft] = useState<{
    readonly source: string;
    readonly filters: AuditLogFilters;
  }>({ source, filters: applied });
  const [now] = useState(() => new Date());
  const filters = draft.source === source ? draft.filters : applied;
  const query = useAuditLogQuery({
    ...applied,
    category: state.category,
    page: state.page,
    limit: AUDIT_LOG_PAGE_LIMIT,
  });
  const errorMessage = query.isError
    ? query.error instanceof ApiError
      ? query.error.problem.detail
      : '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
    : null;

  return (
    <AuditLogView
      records={query.data?.items ?? []}
      counts={query.data?.counts ?? null}
      filters={filters}
      category={state.category}
      view={state.view}
      page={state.page}
      limit={AUDIT_LOG_PAGE_LIMIT}
      total={query.data?.total ?? 0}
      isLoading={query.isFetching}
      errorMessage={errorMessage}
      now={now}
      onFilterChange={(next) => setDraft({ source, filters: next })}
      onSearch={() => navigate({ ...filters, q: filters.q.trim(), page: 1 })}
      onReset={() => {
        setDraft({ source, filters: EMPTY_FILTERS });
        navigate({ ...EMPTY_FILTERS, category: '', page: 1 });
      }}
      onCategoryChange={(category) => navigate({ category, page: 1 })}
      onViewChange={(view) => navigate({ view }, 'replace')}
      onPageChange={(page) => navigate({ page })}
      onRetry={() => void query.refetch()}
    />
  );
}
