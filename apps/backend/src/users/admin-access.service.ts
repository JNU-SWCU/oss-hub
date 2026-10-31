import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import { RolesErrorCode } from './roles-error-code.error';
import {
  AdminAccessMutationService,
  type AdminAccessMutationCommand,
  type AdminAccessMutationResult,
} from './admin-access-mutation.service';
import { AdminAccessRepository } from './admin-access.repository';
import {
  type AdminAccessPrincipal,
  type AdminAccessRepositoryPort,
  type AdminAccessUserDetailRecord,
  type AdminAccessUserRecord,
} from './admin-access-read.repository';
import {
  type AdminAccessFacets,
  type AdminAccessHistoryQuery,
  type AdminAccessListQuery,
  type AdminAccessUserDetail,
  type AdminAccessUserHistory,
  type AdminAccessUserPage,
} from './admin-access-read-ordering.repository';
import { ADMIN_ACCESS_PENDING_FILTERS } from './admin-access-query.config';

@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(AdminAccessRepository)
    private readonly repository: AdminAccessRepositoryPort,
    private readonly auditLog: AuditLogService,
    private readonly adminAccessMutationService: AdminAccessMutationService,
  ) {}

  async list(
    principal: AdminAccessPrincipal,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessUserPage> {
    const actor = this.adminAccessMutationService.requireActiveAdmin(principal);
    const page = await this.repository.list(query);
    return {
      ...page,
      items: page.items.map((user) =>
        withSelfState(
          this.adminAccessMutationService.toAdminAccessUserRecord(user),
          actor,
        ),
      ),
    };
  }

  async listRequests(
    principal: AdminAccessPrincipal,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessUserPage> {
    const actor =
      this.adminAccessMutationService.requireActiveStaffOrAdmin(principal);
    const page = await this.repository.list(
      {
        ...query,
        pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
      },
      'requestQueue',
    );
    return {
      ...page,
      items: page.items.map((user) =>
        withSelfState(
          this.adminAccessMutationService.toAdminAccessUserRecord(user),
          actor,
        ),
      ),
    };
  }

  async get(
    principal: AdminAccessPrincipal,
    userId: string,
  ): Promise<AdminAccessUserDetail> {
    const actor =
      this.adminAccessMutationService.requireActiveStaffOrAdmin(principal);
    const target = await this.requireVisibleTarget(actor, userId);
    return withSelfState(target, actor);
  }

  async facets(
    principal: AdminAccessPrincipal,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessFacets> {
    this.adminAccessMutationService.requireActiveAdmin(principal);
    return this.repository.facets(query);
  }

  async getHistory(
    principal: AdminAccessPrincipal,
    userId: string,
    query: AdminAccessHistoryQuery,
  ): Promise<AdminAccessUserHistory> {
    const actor =
      this.adminAccessMutationService.requireActiveStaffOrAdmin(principal);
    await this.requireVisibleTarget(actor, userId);
    const [staffAccessRequests, loginHistory] = await Promise.all([
      this.repository.listStaffAccessRequestHistory(
        userId,
        query.staffAccessRequests,
      ),
      this.repository.listLoginHistory(userId, query.loginHistory),
    ]);
    return { staffAccessRequests, loginHistory };
  }

  patchAccess(
    actorGithubId: bigint,
    userId: string,
    command: AdminAccessMutationCommand,
  ): Promise<AdminAccessMutationResult> {
    return this.adminAccessMutationService.mutateAdminAccess(
      { repository: this.repository, auditLog: this.auditLog },
      { actorGithubId, userId, command },
    );
  }

  private async requireTarget(
    userId: string,
  ): Promise<AdminAccessUserDetailRecord> {
    const target = await this.repository.findById(userId);
    if (!target) {
      throw this.adminAccessMutationService.roleError(
        RolesErrorCode.USER_NOT_FOUND,
      );
    }
    return this.adminAccessMutationService.toAdminAccessUserDetailRecord(
      target,
    );
  }

  private async requireVisibleTarget(
    actor: AdminAccessPrincipal,
    userId: string,
  ): Promise<AdminAccessUserDetailRecord> {
    const target = await this.requireTarget(userId);
    if (
      this.adminAccessMutationService.isAdminActor(actor) ||
      target.pendingRequest
    ) {
      return target;
    }
    throw this.adminAccessMutationService.roleError(
      RolesErrorCode.USER_NOT_FOUND,
    );
  }
}

function withSelfState<T extends AdminAccessUserRecord>(
  user: T,
  actor: AdminAccessPrincipal,
): Omit<T, 'githubId'> & { readonly isSelf: boolean } {
  const { githubId, ...publicUser } = user;
  return { ...publicUser, isSelf: githubId === actor.githubId };
}
