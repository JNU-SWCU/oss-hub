import { apiClient } from '@/lib/api-client';
import type { SystemStatus } from './types';

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await apiClient<Partial<SystemStatus> | null>(
    'system-status',
  );
  const { collection, provisioning, mail, anomalies } = response ?? {};
  if (!collection || !provisioning || !mail || !anomalies) {
    throw new Error('시스템 상태 응답 형식이 올바르지 않습니다');
  }
  return { collection, provisioning, mail, anomalies };
}

export interface CollectionTriggerResult {
  readonly status: 'PENDING';
  readonly runId: string;
}

export function triggerCollection(): Promise<CollectionTriggerResult> {
  return apiClient<CollectionTriggerResult>('admin/collection/trigger', {
    method: 'POST',
  });
}

export async function retryProvisioning(teamId: string): Promise<void> {
  await apiClient(
    `system-status/provisioning/${encodeURIComponent(teamId)}/retry`,
    { method: 'POST' },
  );
}
