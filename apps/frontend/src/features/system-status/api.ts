import { apiClient } from '@/lib/api-client';
import type { SystemStatusData, SystemStatusResponse } from './types';

export async function fetchSystemStatus(): Promise<SystemStatusData> {
  const response = await apiClient<SystemStatusResponse>('system-status');
  return {
    status: response.collection,
    // 배포 window에는 아직 collectionStreams를 안 주는 구버전 백엔드와 섞일 수
    // 있다 — 그 응답을 undefined 그대로 넘기면 표 쪽 `[...repositories].sort()`가
    // 던진다. 여기서 빈 배열로 정규화해 그 실패를 이 경계 하나로 막는다.
    collectionStreams: response.collectionStreams ?? [],
  };
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
