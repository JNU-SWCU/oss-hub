import { apiClient } from '@/lib/api-client';
import type { SystemStatus, SystemStatusResponse } from './types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

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

export interface DiscoverExternalRepositoriesInput {
  readonly githubLogin: string;
}

export interface DiscoverExternalRepositoriesResult {
  readonly status: 'COMPLETED';
  readonly githubLogin: string;
  readonly discoveredCount: number;
  readonly upsertedCount: number;
  readonly skippedOrgProvisionedCount: number;
}

/** 학생 1명의 조직 밖 public 저장소를 목록에 등록한다(E4). GraphQL 호출 1건 규모라
 * 요청 안에서 완료되고 집계 결과를 그대로 돌려준다 — 실제 commit·PR·release fact 수집은
 * 여기서 하지 않고, 다음 예약 수집 또는 `triggerCollection`이 담당한다. */
export function discoverExternalRepositories(
  input: DiscoverExternalRepositoriesInput,
): Promise<DiscoverExternalRepositoriesResult> {
  return apiClient<DiscoverExternalRepositoriesResult>(
    'admin/collection/discover-external',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}
