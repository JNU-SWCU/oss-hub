import { apiClient } from '@/lib/api-client';
import type { SystemStatus } from './types';

export const STALE_REPOSITORY_PAGE_SIZE = 10;

export async function fetchSystemStatus(
  staleRepositoryPage: number,
): Promise<SystemStatus> {
  const query = new URLSearchParams({
    staleRepositoryPage: String(staleRepositoryPage),
    staleRepositoryLimit: String(STALE_REPOSITORY_PAGE_SIZE),
  });
  const response = await apiClient<Partial<SystemStatus> | null>(
    `system-status?${query.toString()}`,
  );
  const {
    collection,
    provisioning,
    mail,
    anomalies,
    staleRepositories,
    externalCollection,
  } = response ?? {};
  if (
    !collection ||
    !provisioning ||
    !mail ||
    !anomalies ||
    !staleRepositories ||
    !externalCollection
  ) {
    throw new Error('시스템 상태 응답 형식이 올바르지 않습니다');
  }
  return {
    collection,
    provisioning,
    mail,
    anomalies,
    staleRepositories,
    externalCollection,
  };
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
