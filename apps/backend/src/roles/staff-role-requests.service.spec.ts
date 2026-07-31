import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { StaffRoleRequestAction } from './domain/staff-role-request';
import { STAFF_ROLE_REQUEST_ACTIONS } from './domain/staff-role-request';
import { RolesErrorCode } from './roles-error-code.enum';
import { StaffRoleRequestsService } from './staff-role-requests.service';
import {
  ADMIN_GITHUB_ID,
  createAuditLogService,
  createService,
  InMemoryStaffRoleRequestsRepository,
  STAFF_GITHUB_ID,
  staffRoleListQuery,
} from './staff-role-requests.service.spec-support';

describe('StaffRoleRequestsService', () => {
  it('ADMIN은 오래된 PENDING 요청 목록을 조회한다', async () => {
    const result = await createService().list(
      ADMIN_GITHUB_ID,
      staffRoleListQuery(),
    );

    expect(result).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(result.items[0]?.githubLogin).toBe('synthetic-staff');
  });

  it('ADMIN이 PENDING 요청을 승인하면 같은 트랜잭션에서 STAFF 역할을 부여한다', async () => {
    const action: StaffRoleRequestAction = {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    };

    const result = await createService().decide(
      ADMIN_GITHUB_ID,
      'synthetic-request',
      action,
    );

    expect(result).toMatchObject({
      status: RoleRequestStatus.APPROVED,
      userRole: Role.STAFF,
      decidedBy: 'synthetic-admin',
    });
  });

  it('프로필이 미완료인 기존 PENDING 요청은 승인해도 STAFF 역할을 부여하지 않는다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    jest.spyOn(repository, 'findUserProfileById').mockResolvedValue({
      id: 'synthetic-requester',
      name: '합성 사용자',
      studentId: null,
      department: null,
    });
    const service = new StaffRoleRequestsService(
      repository,
      createAuditLogService(),
    );

    const approval = service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    await expect(approval).rejects.toMatchObject({
      errorCode: { code: 'USR_002', status: 409 },
    });
    expect(repository.allRequests()[0]).toMatchObject({
      status: RoleRequestStatus.PENDING,
      userRole: null,
    });
  });

  it('ADMIN이 PENDING 요청을 반려하면 사유를 남기고 역할은 부여하지 않는다', async () => {
    const result = await createService().decide(
      ADMIN_GITHUB_ID,
      'synthetic-request',
      {
        action: STAFF_ROLE_REQUEST_ACTIONS.REJECT,
        reason: '합성 소속 확인 필요',
      },
    );

    expect(result).toMatchObject({
      status: RoleRequestStatus.REJECTED,
      rejectionReason: '합성 소속 확인 필요',
      userRole: null,
    });
  });

  it('ADMIN이 APPROVED 요청을 회수하면 STAFF 역할을 보존하고 계정만 비활성화한다', async () => {
    const service = createService();
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    const result = await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    expect(result).toMatchObject({
      status: RoleRequestStatus.REVOKED,
      userRole: Role.STAFF,
      userAccountStatus: AccountStatus.DEACTIVATED,
      decidedBy: 'synthetic-admin',
    });
    expect(result.decidedAt).toBeInstanceOf(Date);
  });

  it('이미 회수된 요청은 경쟁 처리에서 다시 회수하지 않는다', async () => {
    const service = createService();
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED },
    });
  });

  it('ADMIN 재활성화는 REVOKED 이력을 보존하고 별도 APPROVED 이력을 만든다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const service = new StaffRoleRequestsService(
      repository,
      createAuditLogService(),
    );
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    const result = await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
    });

    expect(result).toMatchObject({
      status: RoleRequestStatus.APPROVED,
      userRole: Role.STAFF,
      userAccountStatus: AccountStatus.ACTIVE,
      decidedBy: 'synthetic-admin',
    });
    expect(repository.allRequests()).toHaveLength(2);
    expect(repository.allRequests()[0]?.status).toBe(RoleRequestStatus.REVOKED);
  });

  it('이미 재활성화된 계정은 같은 REVOKED 이력으로 다시 활성화하지 않는다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const service = new StaffRoleRequestsService(
      repository,
      createAuditLogService(),
    );
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
    });

    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_STATE_CONFLICT },
    });
    expect(repository.allRequests()).toHaveLength(2);
  });

  it('비활성 ADMIN은 목록 조회와 처리를 모두 AUT_003으로 거부한다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    repository.deactivateAdmin();
    const service = new StaffRoleRequestsService(
      repository,
      createAuditLogService(),
    );

    await expect(
      service.list(ADMIN_GITHUB_ID, staffRoleListQuery()),
    ).rejects.toMatchObject({ errorCode: { code: 'AUT_003' } });
    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'AUT_003' } });
  });

  it('ADMIN이 아닌 사용자의 조회와 처리를 거부한다', async () => {
    const service = createService();

    await expect(
      service.list(STAFF_GITHUB_ID, staffRoleListQuery()),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY },
    });
    await expect(
      service.decide(STAFF_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY },
    });
  });

  it('이미 처리된 요청은 다시 처리하지 않는다', async () => {
    const service = createService();
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED },
    });
  });
});
