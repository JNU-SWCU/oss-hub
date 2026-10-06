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
