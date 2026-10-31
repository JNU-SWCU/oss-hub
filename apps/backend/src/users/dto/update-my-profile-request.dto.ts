import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
import {
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  PROFILE_TEXT_PATTERN,
} from '../profile-validation.config';

export { USER_DEPARTMENT_MAX_LENGTH, USER_NAME_MAX_LENGTH };

export class UpdateMyProfileRequestDto {
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidUserName')
  declare readonly name: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/, {
    message: '연락처는 숫자 10~11자리로 입력해 주세요.',
  })
  declare readonly phone?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(transformStaffNumber)
  @IsString()
  @IsProfileText('isValidStaffNumber')
  declare readonly staffNumber?: string | null;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) =>
      request.affiliationKind === undefined &&
      request.affiliationName === undefined,
  )
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment')
  declare readonly department?: string;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) => request.department === undefined,
  )
  @IsString()
  declare readonly affiliationKind?: string;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) => request.department === undefined,
  )
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidAffiliationName')
  declare readonly affiliationName?: string;
}

function transformStaffNumber({ value }: { value: unknown }): unknown {
  const normalized = transformProfileText({ value });
  return normalized === '' ? null : normalized;
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
