import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { requireActiveAdmin } from './admin-access-authorization';
import {
  createIndependentAuthorityAudit,
  type IndependentAuthorityCommand,
} from './independent-authority-audit';
import { roleError, staleAccessError } from './admin-access-mutation-policy';
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
      // 자기 관리자 접근 회수는 성공하는 순간 이 화면을 읽을 권한까지 사라져
      // 누른 사람이 결과를 확인할 수 없다(#1382). 계정 상태 쪽 `ROL_017`과 같은
      // 자리의 가드이며, 판정은 이 경로 한 곳에만 둔다.
      //
      // 순서가 `revokesLastActiveAdmin` 뒤인 것은 의도다 — 활성 관리자가 하나뿐일
      // 때는 기존 `ROL_018`이 그대로 답해야 한다(#1382의 「하지 않을 것」).
      if (
        target === AUTHORITY_TARGETS.ADMIN &&
        !enabled &&
        actor.id === before.id
      ) {
        throw roleError(RolesErrorCode.SELF_ADMIN_REVOKE_FORBIDDEN);
      }
      // 이미 그 상태인 명령은 보낸 쪽이 본 값이 낡았다는 뜻이다. 화면의 드롭다운은
      // 같은 값을 다시 보내지 않으므로(StateControl) 이 요청은 다른 처리자나 다른
      // 창이 먼저 바꾼 뒤에만 나온다. 예전에는 아무것도 쓰지 않고 200 을 돌려줘
      // 화면이 「…처리를 완료했습니다」라고 말했다(#1411). 레거시 CAS 경로와 같은
      // 409 `ROL_013` 과 현재 접근 상태로 돌려, 화면이 충돌 안내를 띄우고 최신
      // 값을 다시 읽게 한다. 던지면 트랜잭션이 롤백되므로 쓰기는 하나도 없다.
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
        createIndependentAuthorityAudit({
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

/**
 * 이 전이가 교직원 접근을 **끄는가**.
 *
 * 회수 이력(`StaffAccessRequest`의 `REVOKED` 행)은 이 한 방향에만 남는다. 부여 전이와
 * 관리자 접근 전이는 교직원 신청 표를 건드리지 않는다 — 관리자 접근 전이는
 * `hasStaffAccess`를 그대로 두므로 이 판정이 켜지지 않는다.
 *
 * 명령 이름이 아니라 **전이 결과**로 본다. 이미 꺼져 있는 접근에 회수를 다시 보내는
 * 요청은 여기까지 오지 않는다 — 위에서 409 `ROL_013`으로 거절한다(#1411).
 */
function revokesStaffAccess(
  before: IndependentAuthorityUserRecord,
  transition: IndependentAuthorityTransition,
): boolean {
  return before.hasStaffAccess && !transition.hasStaffAccess;
}
