import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  ACCESS_AUDIT_SCHEMA_VERSION,
} from '../audit-log/audit-log-metadata';
import { STAFF_ROLE_REQUEST_ACTIONS } from './domain/staff-role-request';
import { RolesErrorCode } from './roles-error-code.enum';
import { StaffRoleRequestsService } from './staff-role-requests.service';
import {
  ADMIN_GITHUB_ID,
  createAuditLogService,
  InMemoryStaffRoleRequestsRepository,
} from './staff-role-requests.service.spec-support';

const ACTOR_SNAPSHOT = {
  displayName: '합성 관리자',
  githubLogin: 'synthetic-admin',
} as const;

describe('StaffRoleRequestsService access audit', () => {
  it('APPROVE는 승인 전후 상태와 이벤트 시점 행위자를 기록한다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const auditLog = createAuditLogService();
    const service = new StaffRoleRequestsService(repository, auditLog);

    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });

    expect(auditLog.record.mock.calls).toEqual([
      [
        {
          actorGithubId: ADMIN_GITHUB_ID,
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_APPROVED,
          targetType: 'ROLE_REQUEST',
          targetId: 'synthetic-request',
          metadata: {
            schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
            actor: ACTOR_SNAPSHOT,
            before: {
              role: null,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: RoleRequestStatus.PENDING,
            },
            after: {
              role: Role.STAFF,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: RoleRequestStatus.APPROVED,
            },
          },
        },
        repository.auditLogWriter,
      ],
    ]);
  });

  it('REJECT만 반려 사유를 포함한다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const auditLog = createAuditLogService();
    const service = new StaffRoleRequestsService(repository, auditLog);

    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });

    expect(auditLog.record.mock.calls).toEqual([
      [
        {
          actorGithubId: ADMIN_GITHUB_ID,
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
          targetType: 'ROLE_REQUEST',
          targetId: 'synthetic-request',
          metadata: {
            schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
            actor: ACTOR_SNAPSHOT,
            before: {
              role: null,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: RoleRequestStatus.PENDING,
            },
            after: {
              role: null,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: RoleRequestStatus.REJECTED,
            },
            rejectionReason: '합성 반려 사유',
          },
        },
        repository.auditLogWriter,
      ],
    ]);
  });

  it('REVOKE는 역할을 보존하고 계정·신청 상태 변경을 기록한다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const auditLog = createAuditLogService();
    const service = new StaffRoleRequestsService(repository, auditLog);
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    auditLog.record.mockClear();

    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });

    expect(auditLog.record.mock.calls).toEqual([
      [
        {
          actorGithubId: ADMIN_GITHUB_ID,
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
          targetType: 'ROLE_REQUEST',
          targetId: 'synthetic-request',
          metadata: {
            schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
            actor: ACTOR_SNAPSHOT,
            before: {
              role: Role.STAFF,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: RoleRequestStatus.APPROVED,
            },
            after: {
              role: Role.STAFF,
              accountStatus: AccountStatus.DEACTIVATED,
              requestStatus: RoleRequestStatus.REVOKED,
            },
          },
        },
        repository.auditLogWriter,
      ],
    ]);
  });

  it('REACTIVATE는 복원 이벤트를 정확히 하나 기록한다', async () => {
    const repository = new InMemoryStaffRoleRequestsRepository();
    const auditLog = createAuditLogService();
    const service = new StaffRoleRequestsService(repository, auditLog);
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE,
    });
    auditLog.record.mockClear();

    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE,
    });

    expect(auditLog.record.mock.calls).toEqual([
      [
        {
          actorGithubId: ADMIN_GITHUB_ID,
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_RESTORED,
          targetType: 'ROLE_REQUEST',
          targetId: 'synthetic-request',
          metadata: {
            schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED,
            actor: ACTOR_SNAPSHOT,
            before: {
              role: Role.STAFF,
              accountStatus: AccountStatus.DEACTIVATED,
              requestStatus: RoleRequestStatus.REVOKED,
            },
            after: {
              role: Role.STAFF,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: RoleRequestStatus.APPROVED,
            },
          },
        },
        repository.auditLogWriter,
      ],
    ]);
  });

  it('거부된 상태 전이는 감사 레코드를 남기지 않는다', async () => {
    const auditLog = createAuditLogService();
    const service = new StaffRoleRequestsService(
      new InMemoryStaffRoleRequestsRepository(),
      auditLog,
    );
    await service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
      action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE,
    });
    auditLog.record.mockClear();

    await expect(
      service.decide(ADMIN_GITHUB_ID, 'synthetic-request', {
        action: STAFF_ROLE_REQUEST_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED },
    });
    expect(auditLog.record.mock.calls).toHaveLength(0);
  });
});
