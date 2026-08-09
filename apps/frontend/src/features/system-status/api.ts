import { apiClient } from '@/lib/api-client';
import type { SystemStatus, SystemStatusResponse } from './types';

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await apiClient<SystemStatusResponse>('system-status');
  return response.collection;
}

export interface CollectionTriggerResult {
  readonly status: 'PENDING';
  readonly runId: string;
}

/** ADMIN이 시간별 cron을 기다리지 않고 수집 sweep을 즉시 실행한다. 202 수락 응답만 받고
 * 실제 진행 상태는 `fetchSystemStatus`를 다시 불러 확인한다. */
export function triggerCollection(): Promise<CollectionTriggerResult> {
  return apiClient<CollectionTriggerResult>('admin/collection/trigger', {
    method: 'POST',
  });
}
