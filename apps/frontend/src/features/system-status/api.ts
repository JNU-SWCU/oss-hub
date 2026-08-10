import { apiClient } from '@/lib/api-client';
import type {
  ExternalCollectionStatus,
  SystemStatusData,
  SystemStatusResponse,
} from './types';

/**
 * externalCollection이 없는 구버전 백엔드 응답을 위한 기본값 — "0개"가 아니라
 * "아직 이 필드를 안 주는 배포"임을 구분하기 위한 정규화 지점이다. `lastSweep`이
 * `null`인 0값은 컴포넌트 쪽에서 "탐색된 저장소가 없다"는 사실만 나타낸다(배포
 * window 자체를 사용자에게 보여주지 않는다 — collectionStreams/collectionActivity와
 * 같은 원칙).
 */
const DEFAULT_EXTERNAL_COLLECTION: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
};

export async function fetchSystemStatus(): Promise<SystemStatusData> {
  const response = await apiClient<SystemStatusResponse>('system-status');
  return {
    status: response.collection,
    // 배포 window에는 아직 collectionStreams를 안 주는 구버전 백엔드와 섞일 수
    // 있다 — 그 응답을 undefined 그대로 넘기면 표 쪽 `[...repositories].sort()`가
    // 던진다. 여기서 빈 배열로 정규화해 그 실패를 이 경계 하나로 막는다.
    collectionStreams: response.collectionStreams ?? [],
    // collectionActivity도 같은 배포 window 문제를 겪는다(2단계) — 구버전
    // 백엔드는 이 필드 자체를 보내지 않는다.
    collectionActivity: response.collectionActivity ?? [],
    // externalCollection도 같은 배포 window 문제를 겪는다(3단계).
    externalCollection:
      response.externalCollection ?? DEFAULT_EXTERNAL_COLLECTION,
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
