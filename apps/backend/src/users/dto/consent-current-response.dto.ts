import type { ConsentStatus } from '../consents.service';

export class ConsentRequiredItemResponseDto {
  declare readonly key: string;
  declare readonly label: string;
  declare readonly documentUrl: string;

  static from(
    item: ConsentStatus['policy']['requiredItems'][number],
  ): ConsentRequiredItemResponseDto {
    return {
      key: item.key,
      label: item.label,
      documentUrl: item.documentUrl,
    };
  }
}

export class ConsentCurrentResponseDto {
  declare readonly policyVersion: string;
  declare readonly requiredItems: ConsentRequiredItemResponseDto[];
  declare readonly consented: boolean;
  declare readonly nextUrl: string;

  static from(status: ConsentStatus): ConsentCurrentResponseDto {
    return {
      policyVersion: status.policy.policyVersion,
      requiredItems: status.policy.requiredItems.map((item) =>
        ConsentRequiredItemResponseDto.from(item),
      ),
      consented: status.consented,
      nextUrl: status.policy.nextUrl,
    };
  }
}
