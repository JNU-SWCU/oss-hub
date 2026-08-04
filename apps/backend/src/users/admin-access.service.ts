import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { requireActiveAdmin } from './admin-access-authorization';
import { roleError } from './admin-access-mutation-policy';
import { mutateAdminAccess } from './admin-access-mutation.service';
import {
  AdminAccessStore,
  type AdminAccessActor,
  type AdminAccessRepositoryPort,
  type AdminAccessUserDetailRecord,
  type AdminAccessUserRecord,
} from './admin-access.store';
import {
  type AdminAccessFacets,
  type AdminAccessHistoryQuery,
  type AdminAccessListQuery,
  type AdminAccessMutationCommand,
  type AdminAccessMutationResult,
  type AdminAccessUserDetail,
  type AdminAccessUserHistory,
  type AdminAccessUserPage,
} from './domain/admin-access';

@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(AdminAccessStore)
    private readonly repository: AdminAccessRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(
    actorGithubId: bigint,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessUserPage> {
    const actor = requireActiveAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
    const page = await this.repository.list(query);
    return {
      ...page,
      items: page.items.map((user) => withSelfState(user, actor)),
    };
  }

  async get(
    actorGithubId: bigint,
    userId: string,
  ): Promise<AdminAccessUserDetail> {
    const actor = requireActiveAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
    return withSelfState(await this.requireTarget(userId), actor);
  }

  async facets(
    actorGithubId: bigint,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessFacets> {
    requireActiveAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
    return this.repository.facets(query);
  }

  async getHistory(
    actorGithubId: bigint,
    userId: string,
    query: AdminAccessHistoryQuery,
  ): Promise<AdminAccessUserHistory> {
    requireActiveAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
    await this.requireTarget(userId);
    const [roleRequests, loginHistory] = await Promise.all([
      this.repository.listRoleRequestHistory(userId, query.roleRequests),
      this.repository.listLoginHistory(userId, query.loginHistory),
    ]);
    return { roleRequests, loginHistory };
  }

  patchAccess(
    actorGithubId: bigint,
    userId: string,
    command: AdminAccessMutationCommand,
  ): Promise<AdminAccessMutationResult> {
    return mutateAdminAccess(
      { repository: this.repository, auditLog: this.auditLog },
      { actorGithubId, userId, command },
    );
  }

  private async requireTarget(
    userId: string,
  ): Promise<AdminAccessUserDetailRecord> {
    const target = await this.repository.findById(userId);
    if (!target) {
      throw roleError(RolesErrorCode.USER_NOT_FOUND);
    }
    return target;
  }
}

function withSelfState<T extends AdminAccessUserRecord>(
  user: T,
  actor: AdminAccessActor,
): Omit<T, 'githubId'> & { readonly isSelf: boolean } {
  const { githubId, ...publicUser } = user;
  return { ...publicUser, isSelf: githubId === actor.githubId };
}
