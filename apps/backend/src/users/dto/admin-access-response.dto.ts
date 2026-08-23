import type {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuthorityLabel } from '../../common/authority-label';
import type {
  AdminAccessFacets,
  AdminAccessMutationResult,
  AdminAccessPendingRequest,
  AdminAccessUser,
  AdminAccessUserDetail,
  AdminAccessUserPage,
} from '../domain/admin-access';
import type { AdminProfileUpdateResult } from '../domain/admin-profile';
import type { IndependentAuthorityMutationResult } from '../domain/independent-authority';

export { AdminAccessUserHistoryResponseDto } from './admin-access-history-response.dto';

type PendingRequestResponseDto = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: string;
};

export class AdminAccessUserResponseDto {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
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
    this.pendingRequest = toPendingRequest(user.pendingRequest);
    this.lastLoginAt = user.lastLoginAt?.toISOString() ?? null;
  }

  static from(user: AdminAccessUser): AdminAccessUserResponseDto {
    return new AdminAccessUserResponseDto(user);
  }
}

export class AdminAccessFacetsResponseDto {
  readonly roles: AdminAccessFacets['roles'];
  readonly accountStatuses: AdminAccessFacets['accountStatuses'];
  readonly pendingRequests: AdminAccessFacets['pendingRequests'];

  private constructor(facets: AdminAccessFacets) {
    this.roles = facets.roles;
    this.accountStatuses = facets.accountStatuses;
    this.pendingRequests = facets.pendingRequests;
  }

  static from(facets: AdminAccessFacets): AdminAccessFacetsResponseDto {
    return new AdminAccessFacetsResponseDto(facets);
  }
}

export class AdminAccessUserPageResponseDto {
  readonly items: readonly AdminAccessUserResponseDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacetsResponseDto;

  private constructor(page: AdminAccessUserPage) {
    this.items = page.items.map((user) =>
      AdminAccessUserResponseDto.from(user),
    );
    this.page = page.page;
    this.limit = page.limit;
    this.total = page.total;
    this.facets = AdminAccessFacetsResponseDto.from(page.facets);
  }

  static from(page: AdminAccessUserPage): AdminAccessUserPageResponseDto {
    return new AdminAccessUserPageResponseDto(page);
  }
}

export class AdminAccessUserDetailResponseDto {
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
    this.pendingRequest = toPendingRequest(user.pendingRequest);
    this.lastLoginAt = user.lastLoginAt?.toISOString() ?? null;
    this.profile = user.profile;
  }

  static from(user: AdminAccessUserDetail): AdminAccessUserDetailResponseDto {
    return new AdminAccessUserDetailResponseDto(user);
  }
}

export class AdminAccessMutationResponseDto {
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly pendingRequest: PendingRequestResponseDto | null;
  readonly decidedRequest: AdminAccessMutationResult['decidedRequest'];

  private constructor(result: AdminAccessMutationResult) {
    this.id = result.id;
    this.role = result.role;
    this.accountStatus = result.accountStatus;
    this.pendingRequest = toPendingRequest(result.pendingRequest);
    this.decidedRequest = result.decidedRequest;
  }

  static from(
    result: AdminAccessMutationResult,
  ): AdminAccessMutationResponseDto {
    return new AdminAccessMutationResponseDto(result);
  }
}

export class IndependentAuthorityMutationResponseDto {
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;

  private constructor(result: IndependentAuthorityMutationResult) {
    this.id = result.id;
    this.role = result.role;
    this.memberKind = result.memberKind;
    this.hasStaffAccess = result.hasStaffAccess;
    this.hasAdminAccess = result.hasAdminAccess;
  }

  static from(
    result: IndependentAuthorityMutationResult,
  ): IndependentAuthorityMutationResponseDto {
    return new IndependentAuthorityMutationResponseDto(result);
  }
}

// CAS를 쓰지 않는 결정이라 이 응답에는 버전 필드가 없다 — 저장 직후 최신 값을
// 그대로 돌려주고, 화면은 이 응답으로만 표시값을 갱신한다.
export class AdminProfileUpdateResponseDto {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;

  private constructor(result: AdminProfileUpdateResult) {
    this.id = result.id;
    this.name = result.name;
    this.studentId = result.studentId;
    this.department = result.department;
  }

  static from(result: AdminProfileUpdateResult): AdminProfileUpdateResponseDto {
    return new AdminProfileUpdateResponseDto(result);
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
