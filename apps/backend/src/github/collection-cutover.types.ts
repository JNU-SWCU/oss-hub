/**
 * todo 14 원자 전환(atomic reader/writer cutover) quiesce lease 계약. `SyncLeaseKey`/
 * `SyncLeaseToken`과 같은 epoch-fenced 상호배제 shape이지만, 별도 테이블(`CollectionCutoverLease`)
 * 이다 — lease 보유 자체가 "cutover 절차 진행 중"을 나타낸다. `scope`는 `SyncLeaseKey`와 같은
 * 일반화된 키다 — cutover는 org sweep 전환 절차이므로 항상 `` `org:${organizationLogin}` ``를
 * 쓴다(external sweep에는 아직 cutover 절차가 없다).
 */
export interface CutoverLeaseKey {
  appId: bigint;
  scope: string;
}

export interface CutoverLeaseToken extends CutoverLeaseKey {
  ownerId: string;
  epoch: bigint;
  runId: string;
  expiresAt: Date;
}

export interface AcquireCutoverLeaseInput extends CutoverLeaseKey {
  ownerId: string;
  runId: string;
  now: Date;
  expiresAt: Date;
}

/**
 * 절차가 abort하는 정확한 사유(acceptance criteria와 1:1 대응) — 모두 명시적 리턴 값이며,
 * silent skip이나 예외로 흡수되지 않는다.
 *  - NO_GENERATION: 성공한 generation이 아직 없다(발명하지 않는다).
 *  - ALREADY_IN_PROGRESS: 다른 cutover 절차가 이미 lease를 보유 중이다.
 *  - POINTER_CHANGED: pin한 activeGenerationId가 재조회 사이 바뀌었다(다른 reconciliation이
 *    끼어들었다는 뜻 — quiesce가 새지 않았다면 원칙적으로 발생하지 않아야 한다).
 *  - UNVERIFIED_STREAMS: provider 재순회 이후에도 VERIFYING 상태로 남은 stream이 있다.
 *  - AGGREGATE_MISMATCH: pin된 generation 중 가입자 경계를 통과한 원장 개수와 증분 facts 개수가 다르다(synthetic parity 실패).
 */
export type CutoverAbortReason =
  | 'NO_GENERATION'
  | 'ALREADY_IN_PROGRESS'
  | 'POINTER_CHANGED'
  | 'UNVERIFIED_STREAMS'
  | 'AGGREGATE_MISMATCH';

export interface CutoverAggregateComparison {
  readonly oldCommitCount: number;
  readonly newCommitCount: number;
  readonly oldPullRequestCount: number;
  readonly newPullRequestCount: number;
  readonly oldReleaseCount: number;
  readonly newReleaseCount: number;
}

export type CutoverResult =
  | {
      readonly status: 'ABORTED';
      readonly reason: CutoverAbortReason;
      readonly generationId: string | null;
    }
  | {
      readonly status: 'COMPLETED';
      readonly generationId: string;
      readonly repositoryCount: number;
      readonly verifiedStreamCount: number;
      readonly syncPasses: number;
      readonly comparison: CutoverAggregateComparison;
    };
