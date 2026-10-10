import { IsString, MaxLength, ValidateIf } from 'class-validator';
import type { DeadlineDigestGuidance } from '../domain/deadline-digest-preview';

export class DeadlineDigestGuidanceRequestDto implements DeadlineDigestGuidance {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  declare readonly studentGuidance?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  declare readonly staffGuidance?: string;
}
