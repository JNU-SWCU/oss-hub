import { IsString, MaxLength, ValidateIf } from 'class-validator';
import type { DeadlineDigestGuidance } from '../deadline-digest-preview';

/** Transport bound only; these plain-text additions are never saved as templates. */
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
