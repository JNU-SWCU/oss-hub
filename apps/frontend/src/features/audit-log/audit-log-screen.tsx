'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { fetchAuditLogs } from './api';
import {
  auditLogStateReducer,
  initialAuditLogState,
  retryAuditLogFilters,
} from './audit-log-state';
import { AuditLogView } from './audit-log-view';
import type { AuditLogFilters, AuditLogRecord } from './types';

export function AuditLogScreen() {
  const [records, setRecords] = useState<readonly AuditLogRecord[]>([]);
  const [filterState, dispatchFilters] = useReducer(
    auditLogStateReducer,
    initialAuditLogState,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (filters: AuditLogFilters) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setRecords(await fetchAuditLogs(filters));
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError
          ? error.problem.detail
          : '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filterState.appliedFilters);
  }, [filterState.appliedFilters, load]);

  return (
    <AuditLogView
      records={records}
      filters={filterState.draftFilters}
      isLoading={isLoading}
      errorMessage={errorMessage}
      onFilterChange={(filters) => dispatchFilters({ type: 'edit', filters })}
      onSearch={() => dispatchFilters({ type: 'search' })}
      onReset={() => dispatchFilters({ type: 'reset' })}
      onRetry={() => void load(retryAuditLogFilters(filterState))}
    />
  );
}
