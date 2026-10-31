import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import { RolesErrorCode, ROLES_ERROR_CODES } from './roles-error-code.error';
import {
  AdminAccessMutationService,
  isAdminActor,
  requireActiveAdmin,
  requireActiveStaffOrAdmin,
  roleError,
  type AdminAccessMutationCommand,
  type AdminAccessMutationResult,
} from './admin-access-mutation.service';
import {
  AdminAccessRepository,
  type AdminAccessActor,
  type AdminAccessRepositoryPort,
  type AdminAccessUserDetailRecord,
  type AdminAccessUserRecord,
} from './admin-access.repository';
import { DomainException } from '../platform/error-code.error';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  type AdminAccessFacets,
  type AdminAccessHistoryQuery,
  type AdminAccessListQuery,
  type AdminAccessUserDetail,
  type AdminAccessUserHistory,
  type AdminAccessUserPage,
} from './admin-access-read-ordering.repository';

const USER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export function requireValidUserId(id: string): void {
  if (id === 'me' || !USER_ID_PATTERN.test(id)) {
    throw new DomainException(
      ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ID],
    );
  }
}

@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(AdminAccessRepository)
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

  async listRequests(
    actorGithubId: bigint,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessUserPage> {
    const actor = requireActiveStaffOrAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
    const page = await this.repository.list(
      {
        ...query,
        pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
      },
      'requestQueue',
    );
    return {
      ...page,
      items: page.items.map((user) => withSelfState(user, actor)),
    };
  }

  async get(
    actorGithubId: bigint,
    userId: string,
  ): Promise<AdminAccessUserDetail> {
    const actor = requireActiveStaffOrAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
    const target = await this.requireVisibleTarget(actor, userId);
    return withSelfState(target, actor);
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
    const actor = requireActiveStaffOrAdmin(
      await this.repository.findActorByGithubId(actorGithubId),
    );
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
    return AdminAccessMutationService.mutateAdminAccess(
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

  private async requireVisibleTarget(
    actor: AdminAccessActor,
    userId: string,
  ): Promise<AdminAccessUserDetailRecord> {
    const target = await this.requireTarget(userId);
    if (isAdminActor(actor) || target.pendingRequest) {
      return target;
    }
    throw roleError(RolesErrorCode.USER_NOT_FOUND);
  }
}

function withSelfState<T extends AdminAccessUserRecord>(
  user: T,
  actor: AdminAccessActor,
): Omit<T, 'githubId'> & { readonly isSelf: boolean } {
  const { githubId, ...publicUser } = user;
  return { ...publicUser, isSelf: githubId === actor.githubId };
}
