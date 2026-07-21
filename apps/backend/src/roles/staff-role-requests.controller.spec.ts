import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import type { StaffRoleRequestRecord } from './domain/staff-role-request';
import { PatchStaffRoleRequestDto } from './dto/patch-staff-role-request.dto';
import { StaffRoleRequestsQueryRequestDto } from './dto/staff-role-requests-query.dto';
import { RolesErrorCode } from './roles-error-code.enum';
import { StaffRoleRequestsController } from './staff-role-requests.controller';
import type { StaffRoleRequestsService } from './staff-role-requests.service';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 1001n,
};
const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');

const pendingRequest: StaffRoleRequestRecord = {
  id: 'synthetic-request',
  userId: 'synthetic-user',
  githubLogin: 'synthetic-staff',
  userRole: null,
  userAccountStatus: AccountStatus.ACTIVE,
  status: RoleRequestStatus.PENDING,
  rejectionReason: null,
  decidedAt: null,
  decidedBy: null,
  createdAt: REQUESTED_AT,
};

function readGuards(target: object, methodName: 'list' | 'decide'): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') {
    return [];
  }
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('StaffRoleRequestsController', () => {
  it('목록 응답에 페이지 정보와 관리자용 요청 필드를 반환한다', async () => {
    // Given
    const list = jest.fn().mockResolvedValue({
      items: [pendingRequest],
      page: 1,
      limit: 20,
      total: 1,
    });
    const service: Pick<StaffRoleRequestsService, 'list' | 'decide'> = {
      list,
      decide: jest.fn(),
    };
    const controller = new StaffRoleRequestsController(service);
    const query = Object.assign(new StaffRoleRequestsQueryRequestDto(), {
      status: RoleRequestStatus.PENDING,
      query: '',
      page: 1,
      limit: 20,
    });

    // When
    const result = await controller.list(REQUEST, query);

    // Then
    expect(result).toEqual({
      items: [
        {
          id: 'synthetic-request',
          githubLogin: 'synthetic-staff',
          requestedRole: Role.STAFF,
          accountStatus: AccountStatus.ACTIVE,
          status: RoleRequestStatus.PENDING,
          requestedAt: REQUESTED_AT.toISOString(),
          decidedAt: null,
          decidedBy: null,
          rejectionReason: null,
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
  });

  it('빈 반려 사유를 도메인 오류로 거부한다', () => {
    // Given
    const body = Object.assign(new PatchStaffRoleRequestDto(), {
      action: 'REJECT',
      reason: '   ',
    });

    // When
    const decide = () => body.toAction();

    // Then
    let thrown: unknown;
    try {
      decide();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainException);
    if (!(thrown instanceof DomainException)) {
      throw new Error('DomainException이 발생해야 합니다.');
    }
    expect(thrown.errorCode.code).toBe(
      RolesErrorCode.REJECTION_REASON_REQUIRED,
    );
  });

  it('REVOKE action을 회수 도메인 명령으로 변환한다', () => {
    // Given
    const body = Object.assign(new PatchStaffRoleRequestDto(), {
      action: 'REVOKE',
    });

    // When
    const action = body.toAction();

    // Then
    expect(action).toEqual({ action: 'REVOKE' });
  });

  it('REACTIVATE action을 관리자 재활성화 명령으로 변환한다', () => {
    const body = Object.assign(new PatchStaffRoleRequestDto(), {
      action: 'REACTIVATE',
    });

    expect(body.toAction()).toEqual({ action: 'REACTIVATE' });
  });

  it('목록은 세션 guard, 처리는 세션과 Origin guard를 적용한다', () => {
    // Given
    const target = StaffRoleRequestsController.prototype;

    // When
    const listGuards = readGuards(target, 'list');
    const patchGuards = readGuards(target, 'decide');

    // Then
    expect(listGuards).toEqual([SessionGuard]);
    expect(patchGuards).toEqual([SessionGuard, OriginGuard]);
  });
});
