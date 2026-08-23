import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import type { AuthorityLabel } from '../domain/authority-label';
import { DomainException } from '../../common/error-code';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessExpectedPendingRequest,
  type AdminAccessMutationCommand,
  type AdminAccessRequestDecision,
} from '../domain/admin-access';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../../roles/roles-error-code.enum';

class ExpectedPendingRequestDto {
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{1,128}$/)
  declare readonly id: string;

  @IsString()
  declare readonly status: string;

  toExpectation(): AdminAccessExpectedPendingRequest {
    if (this.status !== StaffAccessRequestStatus.PENDING) {
      throw invalidDecision();
    }
    return { id: this.id, status: StaffAccessRequestStatus.PENDING };
  }
}

class AdminAccessRequestDecisionRequestDto {
  @IsString()
  declare readonly decision: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;

  toDecision(): AdminAccessRequestDecision {
    switch (this.decision) {
      case ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE:
        return { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE };
      case ADMIN_ACCESS_REQUEST_DECISIONS.REJECT: {
        const reason = this.reason?.trim();
        if (!reason) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.REJECTION_REASON_REQUIRED],
          );
        }
        return { decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT, reason };
      }
      default:
        throw invalidDecision();
    }
  }
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

  toCommand(): AdminAccessMutationCommand {
    return {
      expectedRole: parseRole(this.expectedRole),
      desiredRole: parseRole(this.desiredRole),
      expectedAccountStatus: parseAccountStatus(this.expectedAccountStatus),
      desiredAccountStatus: parseAccountStatus(this.desiredAccountStatus),
      expectedPendingRequest:
        this.expectedPendingRequest?.toExpectation() ?? null,
      ...(this.requestDecision
        ? { requestDecision: this.requestDecision.toDecision() }
        : {}),
    };
  }
}

function parseRole(value: string | null): AuthorityLabel | null {
  switch (value) {
    case null:
      return null;
    case 'STUDENT':
    case 'STAFF':
    case 'ADMIN':
      return value;
    default:
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ROLE],
      );
  }
}

function parseAccountStatus(value: string): AccountStatus {
  switch (value) {
    case AccountStatus.ACTIVE:
    case AccountStatus.DEACTIVATED:
      return value;
    default:
      throw invalidDecision();
  }
}

function invalidDecision(): DomainException {
  return new DomainException(
    ROLES_ERROR_CODES[RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION],
  );
}
