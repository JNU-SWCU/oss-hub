/**
 * todo 10 sync orchestration lease 계약. `CanonicalLeaseKey`/`CanonicalLeaseToken`과 같은
 * epoch-fenced 상호배제 shape이지만, 별도 run 후보 테이블이 없다 — lease 보유 자체가 "진행 중인
 * run"을 나타낸다. `CollectionSyncCursor`(진행 bookkeeping)와는 별개 저장소(`CollectionSyncLease`)다.
 * `scope`는 org sweep(`` `org:${organizationLogin}` ``)과 external sweep(`"external"`)을
 * 서로 다른 lease로 분리하는 일반화된 키다 — 두 sweep은 서로의 lease/45분 run budget을
 * 소비하지 못한다.
 */
export interface SyncLeaseKey {
  appId: bigint;
  scope: string;
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
