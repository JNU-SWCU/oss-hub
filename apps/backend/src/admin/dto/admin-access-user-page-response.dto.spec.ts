import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserPageResponseDto,
} from './admin-access-user-page-response.dto';

const PENDING_AT = new Date('2026-07-30T00:00:00.000Z');
const ACCOUNT_CREATED_AT = new Date('2026-07-29T00:00:00.000Z');
const LOGIN_AT = new Date('2026-07-31T00:00:00.000Z');

describe('admin access response DTO allowlists', () => {
  it('maps list dates to ISO strings without leaking persistence identifiers', () => {
    const page = {
      items: [
        {
          id: 'target',
          phone: 'redacted-synthetic-phone',
          githubLogin: 'synthetic-target',
          name: '합성 사용자',
          role: 'STUDENT' as const,
          memberKind: MemberKind.STUDENT,
          hasStaffAccess: false,
          hasAdminAccess: false,
          accountStatus: AccountStatus.ACTIVE,
          isSelf: false,
          isProfileComplete: true,
          createdAt: ACCOUNT_CREATED_AT,
          pendingRequest: {
            id: 'request-pending',
            status: StaffAccessRequestStatus.PENDING,
            createdAt: PENDING_AT,
          },
          lastLoginAt: LOGIN_AT,
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
      facets: facets(),
    };
    const dto = AdminAccessUserPageResponseDto.from(page);

    expect(dto.items[0]).toEqual({
      id: 'target',
      githubLogin: 'synthetic-target',
      name: '합성 사용자',
      role: 'STUDENT',
      memberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
      isSelf: false,
      isProfileComplete: true,
      createdAt: ACCOUNT_CREATED_AT.toISOString(),
      pendingRequest: {
        id: 'request-pending',
        status: StaffAccessRequestStatus.PENDING,
        createdAt: PENDING_AT.toISOString(),
      },
      lastLoginAt: LOGIN_AT.toISOString(),
    });
    expect(JSON.stringify(dto)).not.toContain('githubId');
    expect(JSON.stringify(dto)).not.toContain('phone');
  });

  it('maps facets and mutation through explicit DTOs', () => {
    const mutation = AdminAccessMutationResponseDto.from({
      id: 'target',
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: null,
      decidedRequest: {
        id: 'request-1',
        status: StaffAccessRequestStatus.APPROVED,
      },
    });

    expect(AdminAccessFacetsResponseDto.from(facets())).toEqual(facets());
    expect(mutation.decidedRequest?.status).toBe(
      StaffAccessRequestStatus.APPROVED,
    );
  });
});

function facets() {
  return {
    roles: { unassigned: 0, student: 1, staff: 0, admin: 0 },
    accountStatuses: { active: 1, deactivated: 0 },
    pendingRequests: { none: 0, pending: 1 },
  };
}
