import { Transform } from 'class-transformer';
import { ApprovalStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsDefined,
  IsString,
  Matches,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
import { PROFILE_TEXT_PATTERN } from '../../users/profile-validation.config';

export class PatchMemberKindRequestDto {
  @IsDefined()
  @IsString()
  declare readonly memberKind: string;

  @IsDefined()
  @IsString()
  declare readonly expectedMemberKind: string;

  @IsDefined()
  @IsBoolean()
  declare readonly expectedHasStaffAccess: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ApprovalStatus)
  declare readonly expectedApprovalStatus?: ApprovalStatus;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  declare readonly expectedApprovalRequestId?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment')
  declare readonly department?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(transformStaffNumber)
  @IsString()
  @IsProfileText('isValidStaffNumber')
  declare readonly staffNumber?: string | null;
}

function transformStaffNumber({ value }: { readonly value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().normalize('NFC') : value;
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function transformProfileText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().normalize('NFC') : value;
}

function isProfileText(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    PROFILE_TEXT_PATTERN.test(value.trim().normalize('NFC'))
  );
}

function IsProfileText(name: string): PropertyDecorator {
  return ValidateBy({ name, validator: { validate: isProfileText } });
}
