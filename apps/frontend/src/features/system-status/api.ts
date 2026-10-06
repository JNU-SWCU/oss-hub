import { apiClient } from '@/lib/api-client';
import type {
  CollectionActivityEntry,
  CollectionActivityWire,
  ExternalCollectionStatus,
  SystemStatusData,
  SystemStatusResponse,
} from './types';

const DEFAULT_EXTERNAL_COLLECTION: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
  cumulativeIssueCount: 0,
};

function toActivity(entry: CollectionActivityWire): CollectionActivityEntry {
  return {
    ...entry,
    kind: entry.kind ?? 'SWEEP',
    insertedIssueCount: entry.insertedIssueCount ?? 0,
  };
}

export async function fetchSystemStatus(): Promise<SystemStatusData> {
  const response = await apiClient<SystemStatusResponse>('system-status');
  return {
    status: response.collection,

    collectionStreams: response.collectionStreams ?? [],

    collectionActivity: (response.collectionActivity ?? []).map(toActivity),

    externalCollection: response.externalCollection
      ? {
          ...response.externalCollection,
          lastSweep: response.externalCollection.lastSweep
            ? toActivity(response.externalCollection.lastSweep)
            : null,
          cumulativeIssueCount:
            response.externalCollection.cumulativeIssueCount ?? 0,
        }
      : DEFAULT_EXTERNAL_COLLECTION,
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
