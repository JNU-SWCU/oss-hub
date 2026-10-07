import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const TEAM_DELETION_NOTIFICATION_MESSAGE_MAX_LENGTH = 500;

export class DeleteTeamExpectedScopeRequestDto {
  @IsInt()
  @Min(0)
  readonly applications!: number;

  @IsInt()
  @Min(0)
  readonly members!: number;

  @IsInt()
  @Min(0)
  readonly invitations!: number;

  @IsInt()
  @Min(0)
  readonly submissions!: number;

  @IsInt()
  @Min(0)
  readonly submissionEvents!: number;

  @IsInt()
  @Min(0)
  readonly detachedRepositories!: number;

  @IsString()
  @Matches(/^[0-9a-f]{32}$/)
  readonly scopeFingerprint!: string;
}

export class DeleteTeamRequestDto {
  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => DeleteTeamExpectedScopeRequestDto)
  readonly expectedScope!: DeleteTeamExpectedScopeRequestDto;

  @IsOptional()
  @IsString()
  @MaxLength(TEAM_DELETION_NOTIFICATION_MESSAGE_MAX_LENGTH)
  readonly notificationMessage?: string;
}
