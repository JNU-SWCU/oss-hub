import type {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuthorityLabel } from '../../users/authority-label.policy';
import type {
  AdminAccessFacets,
  AdminAccessMutationResult,
  AdminAccessPendingRequest,
  AdminAccessUser,
  AdminAccessUserPage,
} from '../../users/admin-access.types';
import type { AdminProfileUpdateResult } from '../../users/admin-profile.types';
import type { IndependentAuthorityMutationResult } from '../../users/independent-authority.types';

type PendingRequestResponseDto = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: string;
};

export class AdminAccessUserResponseDto {
  declare readonly id: string;
  declare readonly githubLogin: string;
  declare readonly name: string | null;
  declare readonly role: AuthorityLabel | null;
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
  declare readonly roles: AdminAccessFacets['roles'];
  declare readonly accountStatuses: AdminAccessFacets['accountStatuses'];
  declare readonly pendingRequests: AdminAccessFacets['pendingRequests'];

  static from(facets: AdminAccessFacets): AdminAccessFacetsResponseDto {
    return {
      roles: facets.roles,
      accountStatuses: facets.accountStatuses,
      pendingRequests: facets.pendingRequests,
    };
  }
}

export class AdminAccessUserPageResponseDto {
  declare readonly items: readonly AdminAccessUserResponseDto[];
  declare readonly page: number;
  declare readonly limit: number;
  declare readonly total: number;
  declare readonly facets: AdminAccessFacetsResponseDto;

  static from(page: AdminAccessUserPage): AdminAccessUserPageResponseDto {
    return {
      items: page.items.map((user) => AdminAccessUserResponseDto.from(user)),
      page: page.page,
      limit: page.limit,
      total: page.total,
      facets: AdminAccessFacetsResponseDto.from(page.facets),
    };
  }
}

export class AdminAccessMutationResponseDto {
  declare readonly id: string;
  declare readonly role: AuthorityLabel | null;
  declare readonly accountStatus: AccountStatus;
  declare readonly pendingRequest: PendingRequestResponseDto | null;
  declare readonly decidedRequest: AdminAccessMutationResult['decidedRequest'];

  static from(
    result: AdminAccessMutationResult,
  ): AdminAccessMutationResponseDto {
    return {
      id: result.id,
      role: result.role,
      accountStatus: result.accountStatus,
      pendingRequest: toPendingRequest(result.pendingRequest),
      decidedRequest: result.decidedRequest,
    };
  }
}

export class IndependentAuthorityMutationResponseDto {
  declare readonly id: string;
  declare readonly role: AuthorityLabel | null;
  declare readonly memberKind: MemberKind | null;
  declare readonly hasStaffAccess: boolean;
  declare readonly hasAdminAccess: boolean;

  static from(
    result: IndependentAuthorityMutationResult,
  ): IndependentAuthorityMutationResponseDto {
    return {
      id: result.id,
      role: result.role,
      memberKind: result.memberKind,
      hasStaffAccess: result.hasStaffAccess,
      hasAdminAccess: result.hasAdminAccess,
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
  return request
    ? {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
      }
    : null;
}
