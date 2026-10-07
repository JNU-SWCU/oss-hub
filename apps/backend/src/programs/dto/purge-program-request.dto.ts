import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmptyObject,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurgeProgramExpectedScopeRequestDto {
  @IsInt()
  @Min(0)
  readonly applications!: number;

  @IsInt()
  @Min(0)
  readonly teams!: number;

  @IsInt()
  @Min(0)
  readonly boardPosts!: number;

  @IsInt()
  @Min(0)
  readonly submissions!: number;

  @IsInt()
  @Min(0)
  readonly submissionEvents!: number;

  @IsString()
  @Matches(/^[0-9a-f]{32}$/)
  readonly scopeFingerprint!: string;
}

export class PurgeProgramRequestDto {
  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => PurgeProgramExpectedScopeRequestDto)
  readonly expectedScope!: PurgeProgramExpectedScopeRequestDto;
}
