import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class CreateConsentRequestDto {
  @IsString()
  @IsNotEmpty()
  policyVersion!: string;

  @IsArray()
  @IsString({ each: true })
  acceptedItems!: string[];
}
