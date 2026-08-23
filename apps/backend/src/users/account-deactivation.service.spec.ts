import { AccountStatus, MemberKind, StaffAccessRequestStatus } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../audit-log/audit-log-metadata';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import type { AuditLogService } from '../audit-log/audit-log.service';
import {
  AccountDeactivationService,
  type AccountDeactivationRepositoryPort,
} from './account-deactivation.service';

describe('AccountDeactivationService', () => {
  const account = {
    id: 'user-1',
    githubId: 42n,
    githubLogin: 'student',
    displayName: '학생',
    selectedMemberKind: MemberKind.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
    requestStatus: null,
  } as const;

  it('deactivates the current account and records the same-transaction audit', async () => {
    const auditLogWriter = {} as AuditLogTransactionWriter;
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
      .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
      .mockResolvedValue(undefined);
    const service = new AccountDeactivationService(repository, {
      record,
    } as unknown as AuditLogService);

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
      .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
      .mockResolvedValue(undefined);
    const service = new AccountDeactivationService(
      {
        withTransaction: (operation) =>
          operation({
            auditLogWriter: {} as AuditLogTransactionWriter,
            findForUpdate: jest.fn().mockResolvedValue({
              ...account,
              role: null,
              requestStatus: StaffAccessRequestStatus.PENDING,
            }),
            lockActiveAdmins: jest.fn(),
            deactivate: jest.fn().mockResolvedValue(true),
          }),
      },
      { record } as unknown as AuditLogService,
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
            auditLogWriter: {} as AuditLogTransactionWriter,
            findForUpdate: jest.fn().mockResolvedValue({
              ...account,
              role: 'ADMIN',
            }),
            lockActiveAdmins: jest.fn().mockResolvedValue(1),
            deactivate,
          }),
      },
      { record: jest.fn() } as unknown as AuditLogService,
    );

    await expect(service.deactivate(42n)).rejects.toMatchObject({
      errorCode: { code: 'USR_007', status: 409 },
    });
    expect(deactivate).not.toHaveBeenCalled();
  });
});
