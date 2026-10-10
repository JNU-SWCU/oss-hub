import {
  IsDateString,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { DeadlineDigestSendRequest } from '../domain/deadline-digest';

export class DeadlineDigestSendRequestDto implements DeadlineDigestSendRequest {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  declare readonly studentGuidance?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  declare readonly staffGuidance?: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly previewedAt: string;

  @Matches(/^[a-f0-9]{64}$/u)
  declare readonly previewVersion: string;
}
