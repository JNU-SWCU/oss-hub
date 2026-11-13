import { apiClient } from '@/lib/api-client';
import type {
  ExternalCollectionStatus,
  SystemStatusData,
  SystemStatusResponse,
} from './types';

const DEFAULT_EXTERNAL_COLLECTION: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSuccessAt: null,
};

export async function fetchSystemStatus(): Promise<SystemStatusData> {
  const response = await apiClient<SystemStatusResponse>('system-status');
  return {
    status: response.collection,
    collectionRepositories: response.collectionRepositories,

    externalCollection:
      response.externalCollection ?? DEFAULT_EXTERNAL_COLLECTION,
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
