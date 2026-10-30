import type {
  AccountStatus,
  LoginHistoryEvent,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuthorityLabel } from '../../users/authority-label.policy';
import type {
  AdminAccessFacets,
  AdminAccessPendingRequest,
  AdminAccessUser,
  AdminAccessUserDetail,
  AdminAccessUserPage,
  AdminAccessUserHistory,
} from '../../users/admin-access.types';

type StaffAccessRequestHistoryItemResponseDto = {
  readonly id: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly createdAt: string;
};

type LoginHistoryItemResponseDto = {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: string;
};

export class AccessRequestsUserHistoryResponseDto {
  declare readonly staffAccessRequests: {
    readonly items: readonly StaffAccessRequestHistoryItemResponseDto[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  declare readonly loginHistory: {
    readonly items: readonly LoginHistoryItemResponseDto[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };

  static from(
    history: AdminAccessUserHistory,
  ): AccessRequestsUserHistoryResponseDto {
    return {
      staffAccessRequests: {
        ...history.staffAccessRequests,
        items: history.staffAccessRequests.items.map((item) => ({
          ...item,
          decidedAt: item.decidedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        })),
      },
      loginHistory: {
        ...history.loginHistory,
        items: history.loginHistory.items.map((item) => ({
          ...item,
          loginAt: item.loginAt.toISOString(),
        })),
      },
    };
  }
}

type PendingRequestResponseDto = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: string;
};

export class AccessRequestsUserResponseDto {
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

  static from(user: AdminAccessUser): AccessRequestsUserResponseDto {
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

export class AccessRequestsFacetsResponseDto {
  declare readonly roles: AdminAccessFacets['roles'];
  declare readonly accountStatuses: AdminAccessFacets['accountStatuses'];
  declare readonly pendingRequests: AdminAccessFacets['pendingRequests'];

  static from(facets: AdminAccessFacets): AccessRequestsFacetsResponseDto {
    return {
      roles: facets.roles,
      accountStatuses: facets.accountStatuses,
      pendingRequests: facets.pendingRequests,
    };
  }
}

export class AccessRequestsUserPageResponseDto {
  declare readonly items: readonly AccessRequestsUserResponseDto[];
  declare readonly page: number;
  declare readonly limit: number;
  declare readonly total: number;
  declare readonly facets: AccessRequestsFacetsResponseDto;

  static from(page: AdminAccessUserPage): AccessRequestsUserPageResponseDto {
    return {
      items: page.items.map((user) => AccessRequestsUserResponseDto.from(user)),
      page: page.page,
      limit: page.limit,
      total: page.total,
      facets: AccessRequestsFacetsResponseDto.from(page.facets),
    };
  }
}

export class AccessRequestsUserDetailResponseDto {
  declare readonly id: string;
  declare readonly githubLogin: string;
  declare readonly name: string | null;
  declare readonly role: AuthorityLabel | null;
  declare readonly memberKind: MemberKind | null;
  declare readonly hasStaffAccess: boolean;
  declare readonly hasAdminAccess: boolean;
  declare readonly accountStatus: AccountStatus;
  declare readonly isSelf: boolean;
  declare readonly isProfileComplete: boolean;
  declare readonly createdAt: string;
  declare readonly pendingRequest: PendingRequestResponseDto | null;
  declare readonly lastLoginAt: string | null;
  declare readonly profile: AdminAccessUserDetail['profile'];

  static from(
    user: AdminAccessUserDetail,
  ): AccessRequestsUserDetailResponseDto {
    return {
      id: user.id,
      githubLogin: user.githubLogin,
      name: user.name,
      role: user.role,
      memberKind: user.memberKind,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
      accountStatus: user.accountStatus,
      isSelf: user.isSelf,
      isProfileComplete: user.isProfileComplete,
      createdAt: user.createdAt.toISOString(),
      pendingRequest: toPendingRequest(user.pendingRequest),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      profile: user.profile,
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
