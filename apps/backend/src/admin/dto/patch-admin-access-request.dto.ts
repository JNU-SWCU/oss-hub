import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class ExpectedPendingRequestDto {
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{1,128}$/)
  declare readonly id: string;

  @IsString()
  declare readonly status: string;
}

class AdminAccessRequestDecisionRequestDto {
  @IsString()
  declare readonly decision: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;
}

export class PatchAdminAccessRequestDto {
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  declare readonly expectedRole: string | null;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  declare readonly desiredRole: string | null;

  @IsDefined()
  @IsString()
  declare readonly expectedAccountStatus: string;

  @IsDefined()
  @IsString()
  declare readonly desiredAccountStatus: string;

  @IsOptional()
  @IsBoolean()
  declare readonly expectedHasStaffAccess?: boolean;

  @IsOptional()
  @IsBoolean()
  declare readonly expectedHasAdminAccess?: boolean;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => ExpectedPendingRequestDto)
  declare readonly expectedPendingRequest: ExpectedPendingRequestDto | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => AdminAccessRequestDecisionRequestDto)
  declare readonly requestDecision?: AdminAccessRequestDecisionRequestDto;
}
