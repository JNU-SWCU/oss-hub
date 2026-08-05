import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  ACCESS_AUDIT_SCHEMA_VERSION,
} from '../audit-log/audit-log-metadata';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './domain/admin-access';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_GITHUB_ID,
  INSERTED_REVOKED_REQUEST_ID,
  InMemoryAdminAccessRepository,
  PENDING_REQUEST,
  accessUser,
  auditLogHarness,
} from './admin-access.service.spec-support';

describe('AdminAccessService mutation', () => {
  it('rejects a stale expected role, account status, or pending request', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: Role.ADMIN,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: {
        currentAccess: {
          id: 'target',
          role: Role.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
          pendingRequest: null,
        },
      },
    });
    expect(repository.userUpdates).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('requires a decision when a pending request accompanies a state change', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      role: null,
      pendingRequest: PENDING_REQUEST,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: null,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: {
          id: PENDING_REQUEST.id,
          status: PENDING_REQUEST.status,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED,
        status: 409,
      },
    });
  });

  it('approves a pending request, updates access, and records one atomic audit', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      role: null,
      pendingRequest: PENDING_REQUEST,
    });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When
    const result = await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: null,
      desiredRole: Role.STAFF,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: {
        id: PENDING_REQUEST.id,
        status: PENDING_REQUEST.status,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE,
      },
    });

    // Then
    expect(result).toMatchObject({
      id: 'target',
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: null,
      decidedRequest: {
        id: PENDING_REQUEST.id,
        status: RoleRequestStatus.APPROVED,
      },
    });
    expect(repository.requestUpdates).toEqual([
      expect.objectContaining({
        requestId: PENDING_REQUEST.id,
        actorId: 'admin',
        nextStatus: RoleRequestStatus.APPROVED,
        rejectionReason: null,
      }),
    ]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorGithubId: ADMIN_GITHUB_ID,
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_APPROVED,
        targetType: 'ROLE_REQUEST',
        targetId: PENDING_REQUEST.id,
        metadata: {
          schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
          actor: {
            displayName: '합성 관리자',
            githubLogin: 'synthetic-admin',
          },
          target: {
            displayName: '합성 사용자',
            githubLogin: 'synthetic-target',
          },
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
    );
  });

  it('rejects a pending request with its reason in the immutable audit', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({ pendingRequest: PENDING_REQUEST });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When
    await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: Role.STUDENT,
      desiredRole: Role.STUDENT,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: {
        id: PENDING_REQUEST.id,
        status: PENDING_REQUEST.status,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
        reason: '합성 반려 사유',
      },
    });

    // Then
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorGithubId: ADMIN_GITHUB_ID,
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
        targetType: 'ROLE_REQUEST',
        targetId: PENDING_REQUEST.id,
        metadata: {
          schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
          actor: {
            displayName: '합성 관리자',
            githubLogin: 'synthetic-admin',
          },
          target: {
            displayName: '합성 사용자',
            githubLogin: 'synthetic-target',
          },
          before: {
            role: Role.STUDENT,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: RoleRequestStatus.PENDING,
          },
          after: {
            role: Role.STUDENT,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: RoleRequestStatus.REJECTED,
          },
          rejectionReason: '합성 반려 사유',
        },
      },
      repository.auditLogWriter,
    );
  });

  it('revokes a directly granted STAFF role by clearing it and inserting a REVOKED request', async () => {
    // Given — 신청 없이 관리자가 직접 올린 STAFF다. APPROVED 행이 아예 없으므로
    // 삽입을 "APPROVED가 있을 때만"으로 좁히면 이 사람은 회수 흔적이 남지 않는다.
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({ role: Role.STAFF, pendingRequest: null });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When
    const result = await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: Role.STAFF,
      desiredRole: null,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    // Then
    expect(result).toEqual({
      id: 'target',
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: null,
      decidedRequest: {
        id: INSERTED_REVOKED_REQUEST_ID,
        status: RoleRequestStatus.REVOKED,
      },
    });
    expect(repository.userUpdates).toEqual([
      {
        userId: 'target',
        expectedRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredRole: null,
        desiredAccountStatus: AccountStatus.ACTIVE,
      },
    ]);
    expect(repository.revokedInserts).toHaveLength(1);
    expect(repository.revokedInserts[0]).toMatchObject({
      userId: 'target',
      actorId: 'admin',
    });
    // 회수는 PENDING 전용 CAS를 절대 타지 않는다.
    expect(repository.requestUpdates).toEqual([]);
    expect(repository.operations).not.toContain('decide-pending-request');
  });

  it('records the revocation as ROLE_REQUEST_REVOKED against the new request row', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({ role: Role.STAFF, pendingRequest: null });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When
    await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: Role.STAFF,
      desiredRole: null,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    // Then — before.requestStatus는 null 그대로다. APPROVED를 채우면 직접 부여
    // STAFF에게는 거짓이 되고, 기존 APPROVED 행은 이 사건으로 변하지 않는다.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorGithubId: ADMIN_GITHUB_ID,
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
        targetType: 'ROLE_REQUEST',
        targetId: INSERTED_REVOKED_REQUEST_ID,
        metadata: {
          schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
          actor: {
            displayName: '합성 관리자',
            githubLogin: 'synthetic-admin',
          },
          target: {
            displayName: '합성 사용자',
            githubLogin: 'synthetic-target',
          },
          before: {
            role: Role.STAFF,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: null,
          },
          after: {
            role: null,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: RoleRequestStatus.REVOKED,
          },
        },
      },
      repository.auditLogWriter,
    );
  });

  it.each([
    ['ADMIN', Role.ADMIN],
    ['STUDENT', Role.STUDENT],
  ])('refuses to clear a confirmed %s role', async (_label, role) => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({ role, pendingRequest: null });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: role,
        desiredRole: null,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
        status: 409,
      },
    });
    expect(repository.userUpdates).toEqual([]);
    expect(repository.revokedInserts).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses to revoke STAFF while a request is still pending', async () => {
    // Given — 여기서 통과시키면 역할만 비고 REVOKED 행이 없는 계정이 생긴다.
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      role: Role.STAFF,
      pendingRequest: PENDING_REQUEST,
    });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: Role.STAFF,
        desiredRole: null,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: {
          id: PENDING_REQUEST.id,
          status: PENDING_REQUEST.status,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
        status: 409,
      },
    });
    expect(repository.revokedInserts).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats a failed user compare-and-swap as a stale command', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.userCasSucceeds = false;
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: Role.STUDENT,
        desiredRole: Role.ADMIN,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: {
        currentAccess: {
          id: 'target',
          role: Role.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
          pendingRequest: null,
        },
      },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
