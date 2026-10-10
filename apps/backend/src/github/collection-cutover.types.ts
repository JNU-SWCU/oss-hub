interface CutoverLeaseKey {
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
