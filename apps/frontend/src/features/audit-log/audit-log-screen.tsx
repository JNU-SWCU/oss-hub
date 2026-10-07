'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { fetchAuditLogs } from './api';
import {
  AUDIT_LOG_PAGE_LIMIT,
  auditLogQueryParams,
  auditLogStateReducer,
  initialAuditLogState,
} from './audit-log-state';
import { AuditLogView } from './audit-log-view';
import type { AuditLogListParams, AuditLogRecord } from './types';

export function AuditLogScreen() {
  const [records, setRecords] = useState<readonly AuditLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [filterState, dispatchFilters] = useReducer(
    auditLogStateReducer,
    initialAuditLogState,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestRequestId = useRef(0);

  const load = useCallback(async (params: AuditLogListParams) => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const page = await fetchAuditLogs(params);
      if (requestId !== latestRequestId.current) return;
      setRecords(page.items);
      setTotal(page.total);
    } catch (error) {
      if (requestId !== latestRequestId.current) return;
      setErrorMessage(
        error instanceof ApiError
          ? error.problem.detail
          : '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      if (requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const { appliedFilters, page } = filterState;
  useEffect(() => {
    void load({ ...appliedFilters, page, limit: AUDIT_LOG_PAGE_LIMIT });
  }, [appliedFilters, page, load]);

  return (
    <AuditLogView
      records={records}
      filters={filterState.draftFilters}
      page={filterState.page}
      limit={AUDIT_LOG_PAGE_LIMIT}
      total={total}
      isLoading={isLoading}
      errorMessage={errorMessage}
      onFilterChange={(filters) => dispatchFilters({ type: 'edit', filters })}
      onSearch={() => dispatchFilters({ type: 'search' })}
      onReset={() => dispatchFilters({ type: 'reset' })}
      onPageChange={(nextPage) =>
        dispatchFilters({ type: 'page', page: nextPage })
      }
      onRetry={() => void load(auditLogQueryParams(filterState))}
    />
  );
}
