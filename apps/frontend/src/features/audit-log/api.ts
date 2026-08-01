import { apiClient } from '@/lib/api-client';
import type { AuditLogListParams, AuditLogPage } from './types';

export function fetchAuditLogs(
  params: AuditLogListParams,
): Promise<AuditLogPage> {
  const search = new URLSearchParams();
  if (params.actor) search.set('actor', params.actor);
  if (params.action) search.set('action', params.action);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  search.set('page', String(params.page));
  search.set('limit', String(params.limit));
  return apiClient<AuditLogPage>(`audit-logs?${search.toString()}`);
}
