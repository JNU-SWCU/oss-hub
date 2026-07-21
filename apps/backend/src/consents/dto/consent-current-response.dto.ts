import { ConsentStatus } from '../consents.service';

export interface ConsentRequiredItemDto {
  key: string;
  label: string;
  documentUrl: string;
}

/**
 * `GET /api/v1/consents/current` 응답 — 필드명(`consented` 포함)은 티켓 #99
 * 본문의 JSON 계약을 그대로 따른다.
 */
export class ConsentCurrentResponseDto {
  policyVersion: string;
  requiredItems: ConsentRequiredItemDto[];
  consented: boolean;
  nextUrl: string;

  private constructor(status: ConsentStatus) {
    this.policyVersion = status.policy.policyVersion;
    this.requiredItems = status.policy.requiredItems.map((item) => ({
      key: item.key,
      label: item.label,
      documentUrl: item.documentUrl,
    }));
    this.consented = status.consented;
    this.nextUrl = status.policy.nextUrl;
  }

  static from(status: ConsentStatus): ConsentCurrentResponseDto {
    return new ConsentCurrentResponseDto(status);
  }
}
