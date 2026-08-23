import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  AccountDeactivationRepository,
  type AccountDeactivationRepositoryPort,
} from './account-deactivation.repository';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';

export type { AccountDeactivationRepositoryPort } from './account-deactivation.repository';

export interface AccountDeactivationResult {
  readonly accountStatus: typeof AccountStatus.DEACTIVATED;
}

@Injectable()
export class AccountDeactivationService {
  constructor(
    @Inject(AccountDeactivationRepository)
    private readonly repository: AccountDeactivationRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  deactivate(githubId: bigint): Promise<AccountDeactivationResult> {
    return this.repository.withTransaction(async (store) => {
      // 관리자 권한 변경 경로와 같은 순서로 잠근다. 대상 행을 먼저 잠그면 서로 다른
      // 관리자가 동시에 상태를 바꿀 때 active-admin 집합 잠금과 교착할 수 있다.
      const activeAdminCount = await store.lockActiveAdmins();
      const account = await store.findForUpdate(githubId);
      if (!account) {
        throw new DomainException(
          AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
        );
      }
      if (account.accountStatus !== AccountStatus.ACTIVE) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.ACCOUNT_ALREADY_DEACTIVATED],
        );
      }
      if (account.hasAdminAccess && activeAdminCount <= 1) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.LAST_ACTIVE_ADMIN],
        );
      }

      const deactivated = await store.deactivate(account.id);
      if (!deactivated) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.ACCOUNT_ALREADY_DEACTIVATED],
        );
      }

      const person = {
        displayName: account.displayName,
        githubLogin: account.githubLogin,
      };
      await this.auditLog.record(
        {
          actorGithubId: githubId,
          action: ACCESS_AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED,
          targetType: 'USER',
          targetId: account.id,
          metadata: createAccessAuditMetadata({
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
            actor: person,
            target: person,
            before: {
              role: account.role,
              accountStatus: AccountStatus.ACTIVE,
              requestStatus: account.requestStatus,
            },
            after: {
              role: account.role,
              accountStatus: AccountStatus.DEACTIVATED,
              requestStatus: account.requestStatus,
            },
          }),
        },
        store.auditLogWriter,
      );

      return { accountStatus: AccountStatus.DEACTIVATED };
    });
  }
}
