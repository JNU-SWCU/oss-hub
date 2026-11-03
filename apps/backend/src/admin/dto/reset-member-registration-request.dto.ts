import { ApprovalStatus } from '@prisma/client';
import {
  IsDefined,
  IsIn,
  IsEnum,
  IsString,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
export class ResetMemberRegistrationRequestDto {
  @IsDefined()
  @IsIn(['STUDENT', 'STAFF'])
  declare readonly expectedMemberKind: 'STUDENT' | 'STAFF';
  @IsDefined()
  @IsEnum(ApprovalStatus)
  declare readonly expectedApprovalStatus: ApprovalStatus;
  @ValidateBy({
    name: 'isRequestIdPresent',
    validator: {
      validate: (value: unknown) => value === null || typeof value === 'string',
    },
  })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  declare readonly expectedApprovalRequestId: string | null;
}
