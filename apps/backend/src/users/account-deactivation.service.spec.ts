import { StaffAccessRequestStatus, MemberKind } from './user-contract.config';
import type { AuthConfig } from '../platform/auth.config';
import { AuthSessionService } from '../platform/auth-session.service';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { UserHistoryRepository } from './user-history.repository';
import {
  AccountDeactivationService,
  type AccountDeactivationRepositoryPort,
} from './account-deactivation.service';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../platform/audit-log-metadata.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
describe('AccountDeactivationService', () => {
  const account = {
    id: 'user-1',
    githubId: 42n,
    githubLogin: 'student',
    displayName: '학생',
    memberKind: MemberKind.STUDENT,
    approvalStatus: 'NOT_REQUIRED',
    profileCreatedAt: new Date('2026-01-01'),
    department: 'Department',
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    requestStatus: null,
  } as const;
  it('deactivates the current account and records the same-transaction audit', async () => {
    const auditLogWriter = new PrismaService();
    const deactivate = jest.fn().mockResolvedValue(true);
    const lockActiveAdmins = jest.fn().mockResolvedValue(2);
    const findForUpdate = jest.fn().mockResolvedValue(account);
    const repository: AccountDeactivationRepositoryPort = {
      withTransaction: (operation) =>
        operation({
          auditLogWriter,
          findForUpdate,
          lockActiveAdmins,
          deactivate,
        }),
    };
    const record = jest
      .fn<Promise<void>, Parameters<UserHistoryRepository['record']>>()
      .mockResolvedValue(undefined);
    const service = new AccountDeactivationService(
      repository,
      {
        record,
      },
      new AuditLogMetadataService(),
      new UserProfileService(),
      { useSecureCookies: false } as AuthConfig,
      new AuthSessionService(),
    );
    await expect(service.deactivate(42n)).resolves.toEqual({
      accountStatus: AccountStatus.DEACTIVATED,
    });
    expect(deactivate).toHaveBeenCalledWith(account.id);
    expect(lockActiveAdmins.mock.invocationCallOrder[0]).toBeLessThan(
      findForUpdate.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    const [auditInput, transactionWriter] = record.mock.calls[0] ?? [];
    expect(auditInput).toMatchObject({
      actorGithubId: 42n,
      action: ACCESS_AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED,
      targetType: 'USER',
      targetId: account.id,
      metadata: {
        eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
        actor: { displayName: '학생', githubLogin: 'student' },
        target: { displayName: '학생', githubLogin: 'student' },
        before: {
          role: 'STUDENT',
          accountStatus: AccountStatus.ACTIVE,
          requestStatus: null,
        },
        after: {
          role: 'STUDENT',
          accountStatus: AccountStatus.DEACTIVATED,
          requestStatus: null,
        },
      },
    });
    expect(transactionWriter).toBe(auditLogWriter);
  });
  it('preserves a pending role-request snapshot in the audit', async () => {
    const record = jest
      .fn<Promise<void>, Parameters<UserHistoryRepository['record']>>()
      .mockResolvedValue(undefined);
    const service = new AccountDeactivationService(
      {
        withTransaction: (operation) =>
          operation({
            auditLogWriter: new PrismaService(),
            findForUpdate: jest.fn().mockResolvedValue({
              ...account,
              memberKind: MemberKind.STAFF,
              approvalStatus: 'PENDING',
              requestStatus: StaffAccessRequestStatus.PENDING,
            }),
            lockActiveAdmins: jest.fn(),
            deactivate: jest.fn().mockResolvedValue(true),
          }),
      },
      { record },
      new AuditLogMetadataService(),
      new UserProfileService(),
      { useSecureCookies: false } as AuthConfig,
      new AuthSessionService(),
    );
    await service.deactivate(42n);
    const pendingAudit = record.mock.calls[0]?.[0];
    expect(pendingAudit?.metadata).toMatchObject({
      before: { requestStatus: StaffAccessRequestStatus.PENDING },
      after: { requestStatus: StaffAccessRequestStatus.PENDING },
    });
  });
  it('does not let the final active admin deactivate itself', async () => {
    const deactivate = jest.fn();
    const service = new AccountDeactivationService(
      {
        withTransaction: (operation) =>
          operation({
            auditLogWriter: new PrismaService(),
            findForUpdate: jest.fn().mockResolvedValue({
              ...account,
              hasAdminAccess: true,
            }),
            lockActiveAdmins: jest.fn().mockResolvedValue(1),
            deactivate,
          }),
      },
      { record: jest.fn() },
      new AuditLogMetadataService(),
      new UserProfileService(),
      { useSecureCookies: false } as AuthConfig,
      new AuthSessionService(),
    );
    await expect(service.deactivate(42n)).rejects.toMatchObject({
      errorCode: { code: 'USR_007', status: 409 },
    });
    expect(deactivate).not.toHaveBeenCalled();
  });
  it('blocks the last admin even when display role is not ADMIN', async () => {
    const deactivate = jest.fn();
    const service = new AccountDeactivationService(
      {
        withTransaction: (operation) =>
          operation({
            auditLogWriter: new PrismaService(),
            findForUpdate: jest.fn().mockResolvedValue({
              ...account,
              hasAdminAccess: true,
            }),
            lockActiveAdmins: jest.fn().mockResolvedValue(1),
            deactivate,
          }),
      },
      { record: jest.fn() },
      new AuditLogMetadataService(),
      new UserProfileService(),
      { useSecureCookies: false } as AuthConfig,
      new AuthSessionService(),
    );
    await expect(service.deactivate(42n)).rejects.toMatchObject({
      errorCode: { code: 'USR_007', status: 409 },
    });
    expect(deactivate).not.toHaveBeenCalled();
  });
  it('does not treat a display-only ADMIN without hasAdminAccess as last admin', async () => {
    const deactivate = jest.fn().mockResolvedValue(true);
    const service = new AccountDeactivationService(
      {
        withTransaction: (operation) =>
          operation({
            auditLogWriter: new PrismaService(),
            findForUpdate: jest.fn().mockResolvedValue({
              ...account,
              hasAdminAccess: false,
            }),
            lockActiveAdmins: jest.fn().mockResolvedValue(1),
            deactivate,
          }),
      },
      { record: jest.fn() },
      new AuditLogMetadataService(),
      new UserProfileService(),
      { useSecureCookies: false } as AuthConfig,
      new AuthSessionService(),
    );
    await expect(service.deactivate(42n)).resolves.toEqual({
      accountStatus: AccountStatus.DEACTIVATED,
    });
    expect(deactivate).toHaveBeenCalledWith(account.id);
  });
});
