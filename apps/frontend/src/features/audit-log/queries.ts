import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { fetchAuditLogs } from './api';
import type { AuditLogListParams } from './types';

export function useAuditLogQuery(input: AuditLogListParams) {
  return useQuery({
    queryKey: featureKey('audit-log', input),
    queryFn: () => fetchAuditLogs(input),
  });
}
