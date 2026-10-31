import type { ConsentGrant } from '../consents.service';

export class ConsentResponseDto {
  declare readonly policyVersion: string;
  declare readonly consentedAt: string;
  declare readonly nextUrl: string;

  static from(grant: ConsentGrant): ConsentResponseDto {
    return {
      policyVersion: grant.policyVersion,
      consentedAt: grant.consentedAt.toISOString(),
      nextUrl: grant.nextUrl,
    };
  }
}
