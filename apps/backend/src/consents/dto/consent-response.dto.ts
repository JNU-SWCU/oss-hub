import { ConsentGrant } from '../domain/consent';

export class ConsentResponseDto {
  policyVersion: string;
  consentedAt: string;
  nextUrl: string;

  private constructor(grant: ConsentGrant) {
    this.policyVersion = grant.policyVersion;
    this.consentedAt = grant.consentedAt.toISOString();
    this.nextUrl = grant.nextUrl;
  }

  static from(grant: ConsentGrant): ConsentResponseDto {
    return new ConsentResponseDto(grant);
  }
}
