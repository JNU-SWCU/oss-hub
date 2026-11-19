'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { periodRange } from './audit-log-format';
import { useAuditLogUrlState } from './audit-log-url-state';
import { useAuditLogQuery } from './queries';
import { AuditLogView } from './audit-log-view';
import type { AuditLogFilters } from './types';

const AUDIT_LOG_PAGE_LIMIT = 50;

export function AuditLogScreen() {
  const { state, navigate } = useAuditLogUrlState();
  const applied: AuditLogFilters = {
    q: state.q,
    action: state.action,
    period: state.period,
    from: state.from,
    to: state.to,
  };
  const source = JSON.stringify(applied);
  const [draft, setDraft] = useState<{
    readonly source: string;
    readonly filters: AuditLogFilters;
  }>({ source, filters: applied });
  const [now] = useState(() => new Date());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filters = draft.source === source ? draft.filters : applied;
  const query = useAuditLogQuery({
    q: applied.q,
    action: applied.action,
    ...periodRange(applied, now),
    category: state.category,
    page: state.page,
    limit: AUDIT_LOG_PAGE_LIMIT,
  });
  const errorMessage = query.isError
    ? query.error instanceof ApiError
      ? query.error.problem.detail
      : '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
    : null;
  const apply = (next: AuditLogFilters) => {
    setSelectedId(null);
    navigate({ ...next, q: next.q.trim(), page: 1 });
  };

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
      fetchedAt={query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null}
      foldLogins={state.category === '' && applied.action === ''}
      selectedId={selectedId}
      onFilterChange={(next) => setDraft({ source, filters: next })}
      onApply={apply}
      onCancel={() => setDraft({ source, filters: applied })}
      onCategoryChange={(category) => {
        setSelectedId(null);
        navigate({ category, page: 1 });
      }}
      onViewChange={(view) => navigate({ view }, 'replace')}
      onPageChange={(page) => {
        setSelectedId(null);
        navigate({ page });
      }}
      onRetry={() => void query.refetch()}
      onSelect={setSelectedId}
      onSearchPerson={(login) => apply({ ...applied, q: login })}
    />
  );
}
