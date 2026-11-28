'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { periodRange } from './audit-log-format';
import {
  DEFAULT_AUDIT_LOG_PAGE_LIMIT,
  useAuditLogUrlState,
} from './audit-log-url-state';
import { useAuditLogQuery } from './queries';
import { AuditLogView } from './audit-log-view';
import type { AuditLogFilters } from './types';

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
  const filters = draft.source === source ? draft.filters : applied;
  const query = useAuditLogQuery({
    q: applied.q,
    action: applied.action,
    ...periodRange(applied, now),
    category: state.category,
    page: state.page,
    limit: state.limit,
  });
  const lastPage =
    query.data === undefined
      ? undefined
      : Math.max(1, Math.ceil(query.data.total / state.limit));
  useEffect(() => {
    if (lastPage !== undefined && state.page > lastPage)
      navigate({ page: lastPage }, 'replace');
  }, [lastPage, state.page, navigate]);
  const errorMessage = query.isError
    ? query.error instanceof ApiError
      ? query.error.problem.detail
      : '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
    : null;
  const apply = (next: AuditLogFilters) => {
    navigate({ ...next, page: 1, limit: DEFAULT_AUDIT_LOG_PAGE_LIMIT });
  };

  return (
    <AuditLogView
      records={query.data?.items ?? []}
      counts={query.data?.counts ?? null}
      filters={filters}
      category={state.category}
      view={state.view}
      page={state.page}
      limit={state.limit}
      total={query.data?.total ?? 0}
      isLoading={query.isFetching}
      errorMessage={errorMessage}
      now={now}
      foldLogins={state.category === '' && applied.action === ''}
      onFilterChange={(next) => setDraft({ source, filters: next })}
      onApply={apply}
      onCancel={() => setDraft({ source, filters: applied })}
      onCategoryChange={(category) =>
        navigate({ category, page: 1, limit: DEFAULT_AUDIT_LOG_PAGE_LIMIT })
      }
      onViewChange={(view) => navigate({ view }, 'replace')}
      onPageChange={(page) => navigate({ page })}
      onRetry={() => void query.refetch()}
      onSearchPerson={(login) => apply({ ...applied, q: login })}
    />
  );
}
