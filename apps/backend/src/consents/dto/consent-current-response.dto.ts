import { ConsentStatus } from '../domain/consent';

export interface ConsentRequiredItemResponseDto {
  key: string;
  label: string;
  documentUrl: string;
}

export class ConsentCurrentResponseDto {
  policyVersion: string;
  requiredItems: ConsentRequiredItemResponseDto[];
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
