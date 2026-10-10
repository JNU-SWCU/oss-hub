import type { AccountStatus } from '@prisma/client';
import type { ConsentPolicy } from './consent-policy';

export interface ConsentStatus {
  policy: ConsentPolicy;
  consented: boolean;
}

export interface ConsentGrant {
  policyVersion: string;
  consentedAt: Date;
  nextUrl: string;
}

export interface ConsentUser {
  readonly id: string;
  readonly accountStatus: AccountStatus;
}

export interface ConsentRecord {
  policyVersion: string;
  consentedAt: Date;
}
