import { apiClient } from '@/lib/api-client';
import { parseAuditLogPage } from './parser';
import type { AuditLogListParams, AuditLogPage } from './types';

export async function fetchAuditLogs(
  params: AuditLogListParams,
): Promise<AuditLogPage> {
  const search = new URLSearchParams();
  if (params.actor) search.set('actor', params.actor);
  if (params.action) search.set('action', params.action);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  search.set('page', String(params.page));
  search.set('limit', String(params.limit));
  const response = await apiClient<unknown>(`audit-logs?${search.toString()}`);
  return parseAuditLogPage(response);
}
