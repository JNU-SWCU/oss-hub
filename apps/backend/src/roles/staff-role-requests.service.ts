import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
  type AccessAuditAction,
  type AccessAuditMetadata,
  type AccessAuditState,
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { isCompleteUserProfile } from '../users/user-profile-policy';
import {
  USERS_ERROR_CODES,
  UsersErrorCode,
} from '../users/users-error-code.enum';
import {
  STAFF_ROLE_REQUEST_ACTIONS,
  type StaffRoleRequestAction,
  type StaffRoleRequestListQuery,
  type StaffRoleRequestRecord,
} from './domain/staff-role-request';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.enum';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';
import type {
  StaffRoleRequestActor,
  StaffRoleRequestsRepositoryPort,
} from './staff-role-requests.repository';

export interface StaffRoleRequestPage {
  readonly items: readonly StaffRoleRequestRecord[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

@Injectable()
export class StaffRoleRequestsService {
  constructor(
    @Inject(StaffRoleRequestsRepository)
    private readonly repository: StaffRoleRequestsRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(
    githubId: bigint,
    query: StaffRoleRequestListQuery,
  ): Promise<StaffRoleRequestPage> {
    this.requireAdmin(await this.repository.findUserByGithubId(githubId));
    const result = await this.repository.list(query);
    return { ...result, page: query.page, limit: query.limit };
  }

  async decide(
    githubId: bigint,
    requestId: string,
    action: StaffRoleRequestAction,
  ): Promise<StaffRoleRequestRecord> {
    return this.repository.withTransaction(async (store) => {
      const actor = this.requireAdmin(await store.findUserByGithubId(githubId));
      const request = await store.findRequestById(requestId);
      if (!request) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.ROLE_REQUEST_NOT_FOUND],
        );
      }
      if (action.action === STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE) {
        if (request.status !== RoleRequestStatus.REVOKED) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED],
          );
        }
        const decidedAt = new Date();
        const accountStatusTransitioned =
          await store.transitionUserAccountStatus({
            userId: request.userId,
            expectedRole: Role.STAFF,
            expectedAccountStatus: AccountStatus.DEACTIVATED,
            nextAccountStatus: AccountStatus.ACTIVE,
          });
        if (!accountStatusTransitioned) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_STATE_CONFLICT],
          );
        }
        const reactivated = await store.createApprovedReactivation({
          userId: request.userId,
          actorId: actor.id,
          decidedAt,
        });
        const audit = createRoleRequestAudit({
          action,
          actor,
          before: request,
          after: reactivated,
        });
        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action: audit.action,
            targetType: 'ROLE_REQUEST',
            targetId: requestId,
            metadata: audit.metadata,
          },
          store.auditLogWriter,
        );
        return reactivated;
      }
      const expectedStatus =
        action.action === STAFF_ROLE_REQUEST_ACTIONS.REVOKE
          ? RoleRequestStatus.APPROVED
          : RoleRequestStatus.PENDING;
      if (request.status !== expectedStatus) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED],
        );
      }

      if (action.action === STAFF_ROLE_REQUEST_ACTIONS.APPROVE) {
        const profile = await store.findUserProfileById(request.userId);
        if (!profile || !isCompleteUserProfile(profile)) {
          throw new DomainException(
            USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
          );
        }
      }

      const decidedAt = new Date();
      const transitioned = await store.transitionRequest({
        requestId,
        actorId: actor.id,
        expectedStatus,
        nextStatus:
          action.action === STAFF_ROLE_REQUEST_ACTIONS.APPROVE
            ? RoleRequestStatus.APPROVED
            : action.action === STAFF_ROLE_REQUEST_ACTIONS.REJECT
              ? RoleRequestStatus.REJECTED
              : RoleRequestStatus.REVOKED,
        rejectionReason:
          action.action === STAFF_ROLE_REQUEST_ACTIONS.REJECT
            ? action.reason
            : null,
        decidedAt,
      });
      if (!transitioned) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED],
        );
      }

      if (action.action === STAFF_ROLE_REQUEST_ACTIONS.APPROVE) {
        const roleTransitioned = await store.transitionUserRole({
          userId: request.userId,
          expectedRole: null,
          expectedAccountStatus: AccountStatus.ACTIVE,
          nextRole: Role.STAFF,
        });
        if (!roleTransitioned) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_STATE_CONFLICT],
          );
        }
      }
      if (action.action === STAFF_ROLE_REQUEST_ACTIONS.REVOKE) {
        const accountStatusTransitioned =
          await store.transitionUserAccountStatus({
            userId: request.userId,
            expectedRole: Role.STAFF,
            expectedAccountStatus: AccountStatus.ACTIVE,
            nextAccountStatus: AccountStatus.DEACTIVATED,
          });
        if (!accountStatusTransitioned) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_STATE_CONFLICT],
          );
        }
      }

      const decided = await store.findRequestById(requestId);
      if (!decided) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.ROLE_REQUEST_NOT_FOUND],
        );
      }
      const audit = createRoleRequestAudit({
        action,
        actor,
        before: request,
        after: decided,
      });
      await this.auditLog.record(
        {
          actorGithubId: githubId,
          action: audit.action,
          targetType: 'ROLE_REQUEST',
          targetId: requestId,
          metadata: audit.metadata,
        },
        store.auditLogWriter,
      );
      return decided;
    });
  }

  private requireAdmin(
    user: StaffRoleRequestActor | null,
  ): StaffRoleRequestActor {
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

type RoleRequestAuditInput = {
  readonly action: StaffRoleRequestAction;
  readonly actor: StaffRoleRequestActor;
  readonly before: StaffRoleRequestRecord;
  readonly after: StaffRoleRequestRecord;
};

type RoleRequestAudit = {
  readonly action: AccessAuditAction;
  readonly metadata: AccessAuditMetadata;
};

function createRoleRequestAudit(
  input: RoleRequestAuditInput,
): RoleRequestAudit {
  const common = {
    actor: {
      displayName: input.actor.name,
      githubLogin: input.actor.githubLogin,
    },
    before: toAccessAuditState(input.before),
    after: toAccessAuditState(input.after),
  };
  switch (input.action.action) {
    case STAFF_ROLE_REQUEST_ACTIONS.APPROVE:
      return {
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_APPROVED,
        metadata: createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
        }),
      };
    case STAFF_ROLE_REQUEST_ACTIONS.REJECT:
      return {
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
        metadata: createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
          rejectionReason: input.action.reason,
        }),
      };
    case STAFF_ROLE_REQUEST_ACTIONS.REVOKE:
      return {
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
        metadata: createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
        }),
      };
    case STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE:
      return {
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_RESTORED,
        metadata: createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED,
        }),
      };
    default: {
      const unsupportedAction: never = input.action;
      throw new TypeError(
        `Unsupported staff role request action: ${JSON.stringify(unsupportedAction)}`,
      );
    }
  }
}

function toAccessAuditState(request: StaffRoleRequestRecord): AccessAuditState {
  return {
    role: request.userRole,
    accountStatus: request.userAccountStatus,
    requestStatus: request.status,
  };
}
