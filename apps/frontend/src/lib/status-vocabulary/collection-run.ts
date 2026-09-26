import type { StatusBadgeVariantName } from './status-badge-variant';

/**
 * 시스템 상태 「최근 수집 활동」 한 줄의 결과 어휘 — 라벨과 배지 변형의 단일 원본(R-35).
 *
 * 한 바퀴 순회는 사이클이 끝났는지(완료·한도·진행 중)를, 저장소를 연결하자마자 그 저장소
 * 하나만 모은 수집은 끝났는지만(#1133) 말한다. 실패는 색만으로 가르지 않고 말로도 적는다.
 */
export type CollectionRunStatusKey =
  | 'CYCLE_COMPLETED'
  | 'BUDGET_STOPPED'
  | 'IN_PROGRESS'
  | 'LINK_COLLECTED'
  | 'LINK_FAILED';

export const COLLECTION_RUN_STATUS_LABEL = {
  CYCLE_COMPLETED: '전체 순회 완료',
  BUDGET_STOPPED: '수집 한도에 도달',
  IN_PROGRESS: '진행 중',
  LINK_COLLECTED: '연결 즉시 수집',
  LINK_FAILED: '연결 즉시 수집 실패',
} as const satisfies Readonly<Record<CollectionRunStatusKey, string>>;

export const COLLECTION_RUN_STATUS_BADGE = {
  CYCLE_COMPLETED: 'approved',
  BUDGET_STOPPED: 'pending',
  IN_PROGRESS: 'recruiting',
  LINK_COLLECTED: 'approved',
  LINK_FAILED: 'rejected',
} as const satisfies Readonly<
  Record<CollectionRunStatusKey, StatusBadgeVariantName>
>;
