import { authorityLabel } from './authority-label.config';
import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { AuditLogService } from '../platform/audit-log.service';
import type {
  AuditLogRecordInput,
  IndependentAuthorityAuditAction,
} from '../platform/audit-log.repository';
import type {
  IndependentAuthorityAuditMetadata,
  AuditPersonSnapshot,
  IndependentAuthorityAuditState,
} from '../platform/audit-log-metadata.config';
import { RolesErrorCode } from './roles-error-code.error';
import {
  IndependentAuthorityRepository,
  type IndependentAuthorityRepositoryPort,
  type IndependentAuthorityTransactionStore,
  type IndependentAuthorityUserRecord,
  IndependentAuthorityState,
  AuthorityTarget,
  IndependentAuthorityTransition,
  type StaffAccessMutationCommand,
  type AdminAuthorityMutationCommand,
  type IndependentAuthorityMutationResult,
} from './independent-authority.repository';
import {
  AUTHORITY_TARGETS,
  STAFF_ACCESS_COMMANDS,
  ADMIN_ACCESS_COMMANDS,
} from './admin-access-query.config';
import { type AdminAccessActor } from './admin-access-read.repository';
import {
  requireActiveAdmin,
  roleError,
  staleAccessError,
} from './admin-access-mutation.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

export function resolveIndependentAuthorityTransition(
  before: IndependentAuthorityState,
  target: AuthorityTarget,
  enabled: boolean,
): IndependentAuthorityTransition {
  const hasStaffAccess =
    target === AUTHORITY_TARGETS.STAFF ? enabled : before.hasStaffAccess;
  const hasAdminAccess =
    target === AUTHORITY_TARGETS.ADMIN ? enabled : before.hasAdminAccess;
  return {
    memberKind: before.memberKind,
    selectedMemberKind: before.memberKind ?? before.selectedMemberKind,
    hasStaffAccess,
    hasAdminAccess,
    role: authorityLabel({
      memberKind: before.memberKind,
      hasStaffAccess,
      hasAdminAccess,
    }),
  };
}

export type IndependentAuthorityCommand =
  StaffAccessMutationCommand | AdminAuthorityMutationCommand;

export type IndependentAuthorityAuditRecordInput = Omit<
  AuditLogRecordInput,
  'action' | 'metadata'
> & {
  readonly action: IndependentAuthorityAuditAction;
  readonly metadata: IndependentAuthorityAuditMetadata;
};

function personSnapshot(person: {
  readonly name: string | null;
  readonly githubLogin: string;
}): AuditPersonSnapshot {
  return {
    displayName: person.name,
    githubLogin: person.githubLogin,
  };
}

function authorityState(
  authority: Pick<
    IndependentAuthorityUserRecord,
    'memberKind' | 'hasStaffAccess' | 'hasAdminAccess' | 'role'
  >,
  accountStatus: IndependentAuthorityUserRecord['accountStatus'],
): IndependentAuthorityAuditState {
  return {
    memberKind: authority.memberKind,
    hasStaffAccess: authority.hasStaffAccess,
    hasAdminAccess: authority.hasAdminAccess,
    role: authority.role,
    accountStatus,
  };
}

@Injectable()
export class IndependentAuthorityService {
  constructor(
    @Inject(IndependentAuthorityRepository)
    private readonly repository: IndependentAuthorityRepositoryPort,
    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
    private readonly auditLogMetadataService: AuditLogMetadataService,
  ) {}

  patchStaffAccess(
    actorGithubId: bigint,
    userId: string,
    command: StaffAccessMutationCommand,
  ): Promise<IndependentAuthorityMutationResult> {
    return this.mutate(
      actorGithubId,
      userId,
      AUTHORITY_TARGETS.STAFF,
      command.command === STAFF_ACCESS_COMMANDS.GRANT,
      command,
    );
  }

  patchAdminAccess(
    actorGithubId: bigint,
    userId: string,
    command: AdminAuthorityMutationCommand,
  ): Promise<IndependentAuthorityMutationResult> {
    return this.mutate(
      actorGithubId,
      userId,
      AUTHORITY_TARGETS.ADMIN,
      command.command === ADMIN_ACCESS_COMMANDS.GRANT,
      command,
    );
  }

  private mutate(
    actorGithubId: bigint,
    userId: string,
    target: AuthorityTarget,
    enabled: boolean,
    command: IndependentAuthorityCommand,
  ): Promise<IndependentAuthorityMutationResult> {
    return this.repository.withTransaction(async (store) => {
      const activeAdminCount = await store.lockActiveAdmins();
      const actor = requireActiveAdmin(
        await store.findActorByGithubId(actorGithubId),
      );
      const before = await requireTarget(store, userId);
      const revokesLastActiveAdmin =
        target === AUTHORITY_TARGETS.ADMIN &&
        before.hasAdminAccess &&
        !enabled &&
        before.accountStatus === AccountStatus.ACTIVE &&
        activeAdminCount <= 1;
      if (revokesLastActiveAdmin) {
        throw roleError(RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED);
      }

      if (
        target === AUTHORITY_TARGETS.ADMIN &&
        !enabled &&
        actor.id === before.id
      ) {
        throw roleError(RolesErrorCode.SELF_ADMIN_REVOKE_FORBIDDEN);
      }

      const current =
        target === AUTHORITY_TARGETS.STAFF
          ? before.hasStaffAccess
          : before.hasAdminAccess;
      if (current === enabled) {
        throw staleAccessError(before);
      }
      const transition = resolveIndependentAuthorityTransition(
        before,
        target,
        enabled,
      );
      await store.updateAuthority(userId, transition);
      if (revokesStaffAccess(before, transition)) {
        await store.insertRevokedRequest({
          userId: before.id,
          actorId: actor.id,
          decidedAt: new Date(),
        });
      }
      await this.auditLog.record(
        this.createIndependentAuthorityAudit({
          actorGithubId,
          actor,
          before,
          after: transition,
          command,
        }),
        store.auditLogWriter,
      );
      return {
        id: before.id,
        role: transition.role,
        memberKind: transition.memberKind,
        hasStaffAccess: transition.hasStaffAccess,
        hasAdminAccess: transition.hasAdminAccess,
      };
    });
  }

  createIndependentAuthorityAudit(input: {
    readonly actorGithubId: bigint;
    readonly actor: AdminAccessActor;
    readonly before: IndependentAuthorityUserRecord;
    readonly after: IndependentAuthorityTransition;
    readonly command: IndependentAuthorityCommand;
  }): IndependentAuthorityAuditRecordInput {
    const { actor, actorGithubId, before: target, after, command } = input;
    const action: IndependentAuthorityAuditAction = command.command;

    return {
      actorGithubId,
      action,
      targetType: 'USER',
      targetId: target.id,
      metadata:
        this.auditLogMetadataService.createIndependentAuthorityAuditMetadata({
          command: command.command,
          actor: personSnapshot(actor),
          target: personSnapshot(target),
          before: authorityState(target, target.accountStatus),
          after: authorityState(after, target.accountStatus),
        }),
    };
  }
}

async function requireTarget(
  store: IndependentAuthorityTransactionStore,
  userId: string,
): Promise<
  NonNullable<
    Awaited<
      ReturnType<IndependentAuthorityTransactionStore['findUserForUpdate']>
    >
  >
> {
  const target = await store.findUserForUpdate(userId);
  if (!target) {
    throw roleError(RolesErrorCode.USER_NOT_FOUND);
  }
  return target;
}

function revokesStaffAccess(
  before: IndependentAuthorityUserRecord,
  transition: IndependentAuthorityTransition,
): boolean {
  return before.hasStaffAccess && !transition.hasStaffAccess;
}
