'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useAuditLogUrlState } from './audit-log-url-state';
import { useAuditLogQuery } from './queries';
import { AUDIT_LOG_PAGE_LIMIT } from './audit-log-state';
import { AuditLogView } from './audit-log-view';
import type { AuditLogFilters } from './types';

export function AuditLogScreen() {
  const { state, navigate } = useAuditLogUrlState();
  const source = JSON.stringify(state);
  const [draft, setDraft] = useState<{
    readonly source: string;
    readonly filters: AuditLogFilters;
  }>({ source, filters: state });
  const filters = draft.source === source ? draft.filters : state;
  const query = useAuditLogQuery({ ...state, limit: AUDIT_LOG_PAGE_LIMIT });
  const errorMessage = query.isError
    ? query.error instanceof ApiError
      ? query.error.problem.detail
      : '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : null;

  return (
    <AuditLogView
      records={query.data?.items ?? []}
      filters={filters}
      page={state.page}
      limit={AUDIT_LOG_PAGE_LIMIT}
      total={query.data?.total ?? 0}
      isLoading={query.isFetching}
      errorMessage={errorMessage}
      onFilterChange={(next) => setDraft({ source, filters: next })}
      onSearch={() =>
        navigate({ ...filters, actor: filters.actor.trim(), page: 1 })
      }
      onReset={() => {
        const empty = { actor: '', action: '', from: '', to: '' };
        setDraft({ source, filters: empty });
        navigate({ ...empty, page: 1 });
      }}
      onPageChange={(page) => navigate({ page })}
      onRetry={() => void query.refetch()}
    />
  );
}
