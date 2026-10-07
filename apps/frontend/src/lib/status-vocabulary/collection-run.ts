import type { StatusBadgeVariantName } from './status-badge-variant';

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
