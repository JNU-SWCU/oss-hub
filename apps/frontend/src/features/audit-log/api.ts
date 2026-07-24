import { apiClient } from '@/lib/api-client';
import type { AuditLogFilters, AuditLogRecord } from './types';

export function fetchAuditLogs(
  filters: AuditLogFilters,
): Promise<readonly AuditLogRecord[]> {
  const search = new URLSearchParams();
  if (filters.actor) search.set('actor', filters.actor);
  if (filters.action) search.set('action', filters.action);
  if (filters.from) search.set('from', filters.from);
  if (filters.to) search.set('to', filters.to);
  const query = search.toString();
  return apiClient<readonly AuditLogRecord[]>(
    query ? `audit-logs?${query}` : 'audit-logs',
  );
}
