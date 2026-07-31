import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import type { AdminUser, AdminUserListQuery } from './domain/admin-user';
import {
  AdminUsersRepository,
  type AdminUserRecord,
  type AdminUsersRepositoryPort,
} from './admin-users.repository';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import { resolveRoleRequestTransition } from '../roles/role-request-transition-rules';

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(AdminUsersRepository)
    private readonly repository: AdminUsersRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(
    actorGithubId: bigint,
    query: AdminUserListQuery,
  ): Promise<readonly AdminUser[]> {
    this.requireAdmin(await this.repository.findUserByGithubId(actorGithubId));
    const users = await this.repository.list(query);
    return users.map((user) => toAdminUser(user, actorGithubId));
  }

  updateRole(
    actorGithubId: bigint,
    userId: string,
    role: Role,
  ): Promise<AdminUser> {
    return this.repository.withTransaction(async (store) => {
      const actor = this.requireAdmin(
        await store.findUserByGithubId(actorGithubId),
      );
      const activeAdminCount = await store.lockActiveAdmins();
      const before = await store.findUserForUpdate(userId);
      if (!before) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.USER_NOT_FOUND],
        );
      }
      if (
        before.role === Role.ADMIN &&
        before.accountStatus === AccountStatus.ACTIVE &&
        role !== Role.ADMIN &&
        activeAdminCount <= 1
      ) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED],
        );
      }
      const updated = await store.updateRole(userId, role);
      if (!updated) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.USER_NOT_FOUND],
        );
      }
      const request = await store.findLatestRoleRequest(userId);
      const nextStatus = resolveRoleRequestTransition(
        request?.status ?? null,
        role,
      );
      if (request && nextStatus) {
        const transitioned = await store.transitionRoleRequest({
          requestId: request.id,
          expectedStatus: request.status,
          nextStatus,
          decidedById: actor.id,
          decidedAt: new Date(),
          rejectionReason: null,
        });
        if (!transitioned) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED],
          );
        }
      }
      await this.auditLog.record(
        {
          actorGithubId,
          action: ACCESS_AUDIT_ACTIONS.DIRECT_ROLE_CHANGED,
          targetType: 'USER',
          targetId: userId,
          metadata: createAccessAuditMetadata({
            eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
            actor: {
              displayName: actor.name,
              githubLogin: actor.githubLogin,
            },
            before: {
              role: before.role,
              accountStatus: before.accountStatus,
              requestStatus: request?.status ?? null,
            },
            after: {
              role: updated.role,
              accountStatus: updated.accountStatus,
              requestStatus: nextStatus ?? request?.status ?? null,
            },
          }),
        },
        store.auditLogWriter,
      );
      return toAdminUser(updated, actorGithubId);
    });
  }

  private requireAdmin(user: AdminUserRecord | null): AdminUserRecord {
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    if (user.role !== Role.ADMIN) {
      throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
    }
    return user;
  }
}

function toAdminUser(user: AdminUserRecord, actorGithubId: bigint): AdminUser {
  return {
    id: user.id,
    githubLogin: user.githubLogin,
    name: user.name,
    role: user.role,
    accountStatus: user.accountStatus,
    isSelf: user.githubId === actorGithubId,
  };
}
