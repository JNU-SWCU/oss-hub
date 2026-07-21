import { IsArray, IsNotEmpty, IsString } from 'class-validator';

/** `POST /api/v1/consents` 요청 본문(#99). 항목 충족 여부 검증은 service가 담당한다. */
export class CreateConsentRequestDto {
  @IsString()
  @IsNotEmpty()
  policyVersion!: string;

  @IsArray()
  @IsString({ each: true })
  acceptedItems!: string[];
}
