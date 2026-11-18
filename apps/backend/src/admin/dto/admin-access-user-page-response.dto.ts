import type { AuthorityLabel } from '../../users/authority-label.types';
import type { AccountStatus, ApprovalStatus } from '@prisma/client';
import type { MemberKind } from '../../users/user-contract.config';
import type {
  AdminAccessFacets,
  AdminAccessPendingRequest,
  AdminAccessUser,
  AdminAccessUserPage,
} from '../../users/admin-access-read-ordering.repository';
import type { AdminAccessMutationResult } from '../../users/admin-access-mutation.service';
import type { AdminProfileUpdateResult } from '../../users/admin-profile-mutation.service';
import type { IndependentAuthorityMutationResult } from '../../users/independent-authority.repository';

class PendingRequestResponseDto {
  declare readonly id: string;
  declare readonly createdAt: string;

  static from(request: AdminAccessPendingRequest): PendingRequestResponseDto {
    return {
      id: request.id,
      createdAt: request.createdAt.toISOString(),
    };
  }
}

export class AdminAccessUserResponseDto {
  declare readonly id: string;
  declare readonly githubLogin: string;
  declare readonly name: string | null;
  declare readonly role: AuthorityLabel | null;
  declare readonly memberKind: AdminAccessUser['memberKind'];
  declare readonly hasStaffAccess: boolean;
  declare readonly hasAdminAccess: boolean;
  declare readonly approvalStatus: ApprovalStatus;
  declare readonly approvalRequestId: string | null;
  declare readonly accountStatus: AccountStatus;
  declare readonly isSelf: boolean;
  declare readonly isProfileComplete: boolean;
  declare readonly createdAt: string;
  declare readonly pendingRequest: PendingRequestResponseDto | null;
  declare readonly lastLoginAt: string | null;

  static from(user: AdminAccessUser): AdminAccessUserResponseDto {
    return {
      id: user.id,
      githubLogin: user.githubLogin,
      name: user.name,
      role: user.role,
      memberKind: user.memberKind,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
      approvalStatus: user.approvalStatus,
      approvalRequestId: user.approvalRequestId,
      accountStatus: user.accountStatus,
      isSelf: user.isSelf,
      isProfileComplete: user.isProfileComplete,
      createdAt: user.createdAt.toISOString(),
      pendingRequest: toPendingRequest(user.pendingRequest),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }
}

export class AdminAccessFacetsResponseDto {
  declare readonly pendingRequests: {
    readonly pending: number;
  };

  static from(facets: AdminAccessFacets): AdminAccessFacetsResponseDto {
    return {
      pendingRequests: { pending: facets.pendingRequests.pending },
    };
  }
}

export class AdminAccessUserPageResponseDto {
  declare readonly items: AdminAccessUserResponseDto[];
  declare readonly total: number;
  declare readonly facets: AdminAccessFacetsResponseDto;

  static from(page: AdminAccessUserPage): AdminAccessUserPageResponseDto {
    return {
      items: page.items.map((user) => AdminAccessUserResponseDto.from(user)),
      total: page.total,
      facets: AdminAccessFacetsResponseDto.from(page.facets),
    };
  }
}

class DecidedRequestResponseDto {
  declare readonly id: string;
  declare readonly status: NonNullable<
    AdminAccessMutationResult['decidedRequest']
  >['status'];

  static from(
    request: NonNullable<AdminAccessMutationResult['decidedRequest']>,
  ): DecidedRequestResponseDto {
    return { id: request.id, status: request.status };
  }
}

export class AdminAccessMutationResponseDto {
  declare readonly id: string;
  declare readonly role: AuthorityLabel | null;
  declare readonly accountStatus: AccountStatus;
  declare readonly pendingRequest: PendingRequestResponseDto | null;
  declare readonly approvalStatus: ApprovalStatus;
  declare readonly approvalRequestId: string | null;
  declare readonly decidedRequest: DecidedRequestResponseDto | null;

  static from(
    result: AdminAccessMutationResult,
  ): AdminAccessMutationResponseDto {
    return {
      id: result.id,
      role: result.role,
      accountStatus: result.accountStatus,
      pendingRequest: toPendingRequest(result.pendingRequest),
      decidedRequest: result.decidedRequest
        ? DecidedRequestResponseDto.from(result.decidedRequest)
        : null,
      approvalStatus: result.approvalStatus,
      approvalRequestId: result.approvalRequestId,
    };
  }
}

export class IndependentAuthorityMutationResponseDto {
  declare readonly id: string;
  declare readonly role: AuthorityLabel | null;
  declare readonly memberKind: MemberKind | null;
  declare readonly hasStaffAccess: boolean;
  declare readonly hasAdminAccess: boolean;
  declare readonly approvalStatus: ApprovalStatus;
  declare readonly approvalRequestId: string | null;

  static from(
    result: IndependentAuthorityMutationResult,
  ): IndependentAuthorityMutationResponseDto {
    return {
      id: result.id,
      role: result.role,
      memberKind: result.memberKind,
      hasStaffAccess: result.hasStaffAccess,
      hasAdminAccess: result.hasAdminAccess,
      approvalStatus: result.approvalStatus,
      approvalRequestId: result.approvalRequestId,
    };
  }
}

export class AdminProfileUpdateResponseDto {
  declare readonly id: string;
  declare readonly name: string | null;
  declare readonly studentId: string | null;
  declare readonly department: string | null;

  static from(result: AdminProfileUpdateResult): AdminProfileUpdateResponseDto {
    return {
      id: result.id,
      name: result.name,
      studentId: result.studentId,
      department: result.department,
    };
  }
}

function toPendingRequest(
  request: AdminAccessPendingRequest | null,
): PendingRequestResponseDto | null {
  return request ? PendingRequestResponseDto.from(request) : null;
}
