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
  readonly staffAccessRequests: {
    readonly items: readonly StaffAccessRequestHistoryItemResponseDto[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  readonly loginHistory: {
    readonly items: readonly LoginHistoryItemResponseDto[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };

  private constructor(history: AdminAccessUserHistory) {
    this.staffAccessRequests = {
      ...history.staffAccessRequests,
      items: history.staffAccessRequests.items.map((item) => ({
        ...item,
        decidedAt: item.decidedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    };
    this.loginHistory = {
      ...history.loginHistory,
      items: history.loginHistory.items.map((item) => ({
        ...item,
        loginAt: item.loginAt.toISOString(),
      })),
    };
  }

  static from(
    history: AdminAccessUserHistory,
  ): AccessRequestsUserHistoryResponseDto {
    return new AccessRequestsUserHistoryResponseDto(history);
  }
}

type PendingRequestResponseDto = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: string;
};

export class AccessRequestsUserResponseDto {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly createdAt: string;
  readonly pendingRequest: PendingRequestResponseDto | null;
  readonly lastLoginAt: string | null;

  private constructor(user: AdminAccessUser) {
    this.id = user.id;
    this.githubLogin = user.githubLogin;
    this.name = user.name;
    this.role = user.role;
    this.accountStatus = user.accountStatus;
    this.isSelf = user.isSelf;
    this.isProfileComplete = user.isProfileComplete;
    this.createdAt = user.createdAt.toISOString();
    this.pendingRequest = toPendingRequest(user.pendingRequest);
    this.lastLoginAt = user.lastLoginAt?.toISOString() ?? null;
  }

  static from(user: AdminAccessUser): AccessRequestsUserResponseDto {
    return new AccessRequestsUserResponseDto(user);
  }
}

export class AccessRequestsFacetsResponseDto {
  readonly roles: AdminAccessFacets['roles'];
  readonly accountStatuses: AdminAccessFacets['accountStatuses'];
  readonly pendingRequests: AdminAccessFacets['pendingRequests'];

  private constructor(facets: AdminAccessFacets) {
    this.roles = facets.roles;
    this.accountStatuses = facets.accountStatuses;
    this.pendingRequests = facets.pendingRequests;
  }

  static from(facets: AdminAccessFacets): AccessRequestsFacetsResponseDto {
    return new AccessRequestsFacetsResponseDto(facets);
  }
}

export class AccessRequestsUserPageResponseDto {
  readonly items: readonly AccessRequestsUserResponseDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AccessRequestsFacetsResponseDto;

  private constructor(page: AdminAccessUserPage) {
    this.items = page.items.map((user) =>
      AccessRequestsUserResponseDto.from(user),
    );
    this.page = page.page;
    this.limit = page.limit;
    this.total = page.total;
    this.facets = AccessRequestsFacetsResponseDto.from(page.facets);
  }

  static from(page: AdminAccessUserPage): AccessRequestsUserPageResponseDto {
    return new AccessRequestsUserPageResponseDto(page);
  }
}

export class AccessRequestsUserDetailResponseDto {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AuthorityLabel | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly createdAt: string;
  readonly pendingRequest: PendingRequestResponseDto | null;
  readonly lastLoginAt: string | null;
  readonly profile: AdminAccessUserDetail['profile'];

  private constructor(user: AdminAccessUserDetail) {
    this.id = user.id;
    this.githubLogin = user.githubLogin;
    this.name = user.name;
    this.role = user.role;
    this.memberKind = user.memberKind;
    this.hasStaffAccess = user.hasStaffAccess;
    this.hasAdminAccess = user.hasAdminAccess;
    this.accountStatus = user.accountStatus;
    this.isSelf = user.isSelf;
    this.isProfileComplete = user.isProfileComplete;
    this.createdAt = user.createdAt.toISOString();
    this.pendingRequest = toPendingRequest(user.pendingRequest);
    this.lastLoginAt = user.lastLoginAt?.toISOString() ?? null;
    this.profile = user.profile;
  }

  static from(
    user: AdminAccessUserDetail,
  ): AccessRequestsUserDetailResponseDto {
    return new AccessRequestsUserDetailResponseDto(user);
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
