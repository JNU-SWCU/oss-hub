import {
  AccountStatus,
  LoginHistoryEvent,
  StaffAccessRequestStatus,
} from '@prisma/client';
import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserDetailResponseDto,
  AdminAccessUserHistoryResponseDto,
  AdminAccessUserPageResponseDto,
} from './admin-access-response.dto';

const PENDING_AT = new Date('2026-07-30T00:00:00.000Z');
const LOGIN_AT = new Date('2026-07-31T00:00:00.000Z');

describe('admin access response DTO allowlists', () => {
  it('maps list dates to ISO strings without leaking persistence identifiers', () => {
    const dto = AdminAccessUserPageResponseDto.from({
      items: [
        {
          id: 'target',
          githubLogin: 'synthetic-target',
          name: '합성 사용자',
          role: 'STUDENT',
          accountStatus: AccountStatus.ACTIVE,
          isSelf: false,
          isProfileComplete: true,
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
    });

    expect(dto.items[0]).toEqual({
      id: 'target',
      githubLogin: 'synthetic-target',
      name: '합성 사용자',
      role: 'STUDENT',
      accountStatus: AccountStatus.ACTIVE,
      isSelf: false,
      isProfileComplete: true,
      pendingRequest: {
        id: 'request-pending',
        status: StaffAccessRequestStatus.PENDING,
        createdAt: PENDING_AT.toISOString(),
      },
      lastLoginAt: LOGIN_AT.toISOString(),
    });
    expect(JSON.stringify(dto)).not.toContain('githubId');
  });

  it('maps detail, separate histories, facets, and mutation through explicit DTOs', () => {
    const detail = AdminAccessUserDetailResponseDto.from({
      id: 'target',
      githubLogin: 'synthetic-target',
      name: '합성 사용자',
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
      isSelf: false,
      isProfileComplete: true,
      pendingRequest: null,
      lastLoginAt: null,
      profile: {
        name: '합성 사용자',
        studentId: '123456',
        department: '소프트웨어공학과',
        isComplete: true,
      },
    });
    const history = AdminAccessUserHistoryResponseDto.from({
      staffAccessRequests: {
        items: [
          {
            id: 'request-1',
            status: StaffAccessRequestStatus.REJECTED,
            rejectionReason: '합성 반려 사유',
            decidedAt: PENDING_AT,
            decidedBy: 'synthetic-admin',
            createdAt: PENDING_AT,
          },
        ],
        page: 2,
        limit: 5,
        total: 1,
      },
      loginHistory: {
        items: [
          {
            id: 'login-1',
            event: LoginHistoryEvent.LOGIN,
            provider: 'github',
            success: true,
            loginAt: LOGIN_AT,
          },
        ],
        page: 3,
        limit: 10,
        total: 1,
      },
    });
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

    expect(detail).toMatchObject({
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
    });
    expect(detail.profile.studentId).toBe('123456');
    expect(history.staffAccessRequests.items[0]?.createdAt).toBe(
      PENDING_AT.toISOString(),
    );
    expect(history.loginHistory.items[0]?.loginAt).toBe(LOGIN_AT.toISOString());
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
