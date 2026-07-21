import { ConsentGrant } from '../consents.service';

/** `POST /api/v1/consents` 성공 응답 — consentedAt은 ISO 8601(UTC)로 직렬화한다. */
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
