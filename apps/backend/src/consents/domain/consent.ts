import type { AccountStatus } from '@prisma/client';

export interface ConsentUser {
  readonly id: string;
  readonly accountStatus: AccountStatus;
}

export interface ConsentRecord {
  policyVersion: string;
  consentedAt: Date;
}
