/**
 * todo 10 sync orchestration lease 계약. `CanonicalLeaseKey`/`CanonicalLeaseToken`과 같은
 * epoch-fenced 상호배제 shape이지만, 별도 run 후보 테이블이 없다 — lease 보유 자체가 "진행 중인
 * run"을 나타낸다. `CollectionSyncCursor`(진행 bookkeeping)와는 별개 저장소(`CollectionSyncLease`)다.
 */
export interface SyncLeaseKey {
  appId: bigint;
  organizationLogin: string;
}

export interface SyncLeaseToken extends SyncLeaseKey {
  ownerId: string;
  epoch: bigint;
  runId: string;
  expiresAt: Date;
}

export interface AcquireSyncLeaseInput extends SyncLeaseKey {
  ownerId: string;
  runId: string;
  now: Date;
  expiresAt: Date;
}
