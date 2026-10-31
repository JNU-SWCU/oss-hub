import { IsDefined, IsString } from 'class-validator';

export class PatchIndependentAuthorityRequestDto {
  @IsDefined()
  @IsString()
  declare readonly command: string;
}
