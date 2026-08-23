import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { requireActiveAdmin } from './admin-access-authorization';
import {
  createIndependentAuthorityAudit,
  type IndependentAuthorityCommand,
} from './independent-authority-audit';
import { roleError } from './admin-access-mutation-policy';
import {
  ADMIN_ACCESS_COMMANDS,
  STAFF_ACCESS_COMMANDS,
  type AdminAuthorityMutationCommand,
  type IndependentAuthorityMutationResult,
  type StaffAccessMutationCommand,
} from './domain/independent-authority';
import {
  IndependentAuthorityRepository,
  type IndependentAuthorityRepositoryPort,
  type IndependentAuthorityTransactionStore,
  type IndependentAuthorityUserRecord,
} from './independent-authority.repository';
import {
  AUTHORITY_TARGETS,
  resolveIndependentAuthorityTransition,
  type AuthorityTarget,
  type IndependentAuthorityTransition,
} from './independent-authority-transition';

@Injectable()
export class IndependentAuthorityService {
  constructor(
    @Inject(IndependentAuthorityRepository)
    private readonly repository: IndependentAuthorityRepositoryPort,
    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
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
      const transition = resolveIndependentAuthorityTransition(
        before,
        target,
        enabled,
      );
      if (authorityChanged(before, transition)) {
        await store.updateAuthority(userId, transition);
        await this.auditLog.record(
          createIndependentAuthorityAudit({
            actorGithubId,
            actor,
            before,
            after: transition,
            command,
          }),
          store.auditLogWriter,
        );
      }
      return {
        id: before.id,
        role: transition.role,
        memberKind: transition.memberKind,
        hasStaffAccess: transition.hasStaffAccess,
        hasAdminAccess: transition.hasAdminAccess,
      };
    });
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

function authorityChanged(
  before: IndependentAuthorityUserRecord,
  transition: IndependentAuthorityTransition,
): boolean {
  return (
    before.hasStaffAccess !== transition.hasStaffAccess ||
    before.hasAdminAccess !== transition.hasAdminAccess ||
    before.role !== transition.role ||
    before.selectedMemberKind !== transition.selectedMemberKind
  );
}
