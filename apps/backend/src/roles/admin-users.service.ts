import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import type { AdminUser, AdminUserListQuery } from './domain/admin-user';
import {
  AdminUsersRepository,
  type AdminUserRecord,
  type AdminUsersRepositoryPort,
} from './admin-users.repository';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.enum';

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
      this.requireAdmin(await store.findUserByGithubId(actorGithubId));
      if (!(await store.findUserById(userId))) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.USER_NOT_FOUND],
        );
      }
      const updated = await store.updateRole(userId, role);
      if (!updated) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.USER_NOT_FOUND],
        );
      }
      await this.auditLog.record(
        {
          actorGithubId,
          action: 'USER_ROLE_CHANGED',
          targetType: 'USER',
          targetId: userId,
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
