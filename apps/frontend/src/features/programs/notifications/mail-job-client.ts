import { apiClient } from '@/lib/api-client';
export type AcceptedMailJob = {
  readonly jobId: string;
  readonly status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
};
export function mailRequest<T>(
  id: string,
  action: 'previews' | 'jobs',
  kind: 'PROGRAM' | 'DEADLINE',
  draft: object,
) {
  return apiClient<T>(`programs/${encodeURIComponent(id)}/mail/${action}`, {
    method: 'POST',
    body: JSON.stringify({ kind, draft }),
  });
}
