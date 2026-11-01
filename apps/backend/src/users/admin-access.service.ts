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
  type AdminAccessPendingFilter,
  type AdminAccessRoleFilter,
  type AdminAccessSortDirection,
  type AdminAccessSortField,
  type AdminAccessUserDetail,
  type AdminAccessUserHistory,
  type AdminAccessUserPage,
} from './admin-access-read-ordering.repository';
import {
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_SORT,
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_SORT_DIRECTIONS,
  ADMIN_ACCESS_SORT_FIELDS,
} from './admin-access-query.config';
import type { AccountStatus } from '@prisma/client';
import type { AdminAccessPatchRequest } from './admin-access-mutation.service';

export interface AdminAccessListRequest {
  readonly query?: string;
  readonly role?: AdminAccessRoleFilter;
  readonly accountStatus?: AccountStatus;
  readonly pendingRequest?: AdminAccessPendingFilter;
  readonly sort?: AdminAccessSortField;
  readonly direction?: AdminAccessSortDirection;
  readonly page?: number;
  readonly limit?: number;
}

export interface AdminAccessHistoryRequest {
  readonly staffAccessRequestPage?: number;
  readonly staffAccessRequestLimit?: number;
  readonly loginPage?: number;
  readonly loginLimit?: number;
}

@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(AdminAccessRepository)
    private readonly repository: AdminAccessRepositoryPort,
    private readonly auditLog: AuditLogService,
    private readonly adminAccessMutationService: AdminAccessMutationService,
  ) {}

  listQueryFromRequest(request: AdminAccessListRequest): AdminAccessListQuery {
    return {
      query: request.query ?? '',
      ...(request.role === undefined ? {} : { role: request.role }),
      ...(request.accountStatus === undefined
        ? {}
        : { accountStatus: request.accountStatus }),
      ...(request.pendingRequest === undefined
        ? {}
        : { pendingRequest: request.pendingRequest }),
      sort: request.sort ?? ADMIN_ACCESS_DEFAULT_SORT,
      direction: request.direction ?? ADMIN_ACCESS_DEFAULT_DIRECTION,
      page: request.page ?? 1,
      limit: request.limit ?? 20,
    };
  }

  requestQueueQueryFromRequest(
    request: AdminAccessListRequest,
  ): AdminAccessListQuery {
    return {
      query: request.query ?? '',
      ...(request.role === undefined ? {} : { role: request.role }),
      ...(request.accountStatus === undefined
        ? {}
        : { accountStatus: request.accountStatus }),
      pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
      sort: request.sort ?? ADMIN_ACCESS_SORT_FIELDS.CREATED_AT,
      direction: request.direction ?? ADMIN_ACCESS_SORT_DIRECTIONS.DESC,
      page: request.page ?? 1,
      limit: request.limit ?? 20,
    };
  }

  historyQueryFromRequest(
    request: AdminAccessHistoryRequest,
  ): AdminAccessHistoryQuery {
    return {
      staffAccessRequests: {
        page: request.staffAccessRequestPage ?? 1,
        limit: request.staffAccessRequestLimit ?? 20,
      },
      loginHistory: {
        page: request.loginPage ?? 1,
        limit: request.loginLimit ?? 20,
      },
    };
  }

  async list(
    principal: AdminAccessPrincipal,
    request: AdminAccessListRequest,
  ): Promise<AdminAccessUserPage> {
    const actor = this.adminAccessMutationService.requireActiveAdmin(principal);
    const page = await this.repository.list(this.listQueryFromRequest(request));
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
    request: AdminAccessListRequest,
  ): Promise<AdminAccessUserPage> {
    const actor =
      this.adminAccessMutationService.requireActiveStaffOrAdmin(principal);
    const page = await this.repository.list(
      {
        ...this.requestQueueQueryFromRequest(request),
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
    request: AdminAccessListRequest,
  ): Promise<AdminAccessFacets> {
    this.adminAccessMutationService.requireActiveAdmin(principal);
    return this.repository.facets(this.listQueryFromRequest(request));
  }

  getFromRequest(
    principal: AdminAccessPrincipal,
    userId: string,
  ): Promise<AdminAccessUserDetail> {
    this.adminAccessMutationService.requireValidUserId(userId);
    return this.get(principal, userId);
  }

  getHistoryFromRequest(
    principal: AdminAccessPrincipal,
    userId: string,
    request: AdminAccessHistoryRequest,
  ): Promise<AdminAccessUserHistory> {
    this.adminAccessMutationService.requireValidUserId(userId);
    return this.getHistory(
      principal,
      userId,
      this.historyQueryFromRequest(request),
    );
  }

  patchAccessFromRequest(
    actorGithubId: bigint,
    userId: string,
    request: AdminAccessPatchRequest,
  ): Promise<AdminAccessMutationResult> {
    this.adminAccessMutationService.requireValidUserId(userId);
    return this.patchAccess(
      actorGithubId,
      userId,
      this.adminAccessMutationService.commandFromPatchAccessRequest(request),
    );
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
