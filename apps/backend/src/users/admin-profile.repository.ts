import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import { upsertCompatibleProfile } from '../profiles/profile-compatibility.repository';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminAccessActor } from './admin-access.repository.types';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
} from './admin-actor-locks';
import type {
  AdminProfileApplyOutcome,
  AdminProfileLegacyFields,
  AdminProfileRepositoryPort,
  AdminProfileTargetRecord,
  AdminProfileTransactionStore,
  AdminProfileWriteFields,
} from './admin-profile.repository.types';

export type {
  AdminProfileApplyOutcome,
  AdminProfileLegacyFields,
  AdminProfileRepositoryPort,
  AdminProfileTargetRecord,
  AdminProfileTransactionStore,
  AdminProfileWriteFields,
} from './admin-profile.repository.types';

const ADMIN_PROFILE_TARGET_SELECT = {
  id: true,
  nickname: true,
  ...COMPATIBLE_PROFILE_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminProfileTarget = Prisma.UserGetPayload<{
  select: typeof ADMIN_PROFILE_TARGET_SELECT;
}>;

class PrismaAdminProfileTransactionStore implements AdminProfileTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockActiveAdmins(): Promise<void> {
    await lockActiveAdminRows(this.transaction);
  }

  findActor(githubId: bigint): Promise<AdminAccessActor | null> {
    return findAdminActorByGithubId(this.transaction, githubId);
  }

  async findTarget(userId: string): Promise<AdminProfileTargetRecord | null> {
    const user = await this.transaction.user.findUnique({
      where: { id: userId },
      select: ADMIN_PROFILE_TARGET_SELECT,
    });
    return user ? toAdminProfileTargetRecord(user) : null;
  }

  /**
   * `upsertCompatibleProfile`(#profiles/profile-compatibility.repository)을 그대로
   * 쓴다 — UserProfile 행이 없던 계정은 `fields`(세 컬럼 모두)로 새로 만들고, 있던
   * 계정은 `changedFields`(커맨드에 실제로 실린 필드만)로 갱신하면서 구버전 `User`
   * 컬럼도 같은 트랜잭션에서 맞춘다. 커맨드에 없는 필드를 UPDATE 문에 싣지 않아야
   * 동시에 다른 필드를 고친 다른 관리자의 값을 되돌리지 않는다(lost-update, #787 리뷰).
   *
   * 이건 "이미 있는 값을 덮어써도 되는가"를 다루는 CAS 미도입 결정과는 별개다 — 그
   * 결정은 그대로다: 사전 소유자 조회 없이 곧바로 쓰고, 유일성 위반만 P2002로 잡아 낸다.
   */
  async applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome> {
    try {
      await upsertCompatibleProfile(
        this.transaction,
        userId,
        fields,
        changedFields,
      );
      return 'applied';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'studentIdTaken';
      }
      throw error;
    }
  }

  async applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) {
      return;
    }
    await this.transaction.user.update({ where: { id: userId }, data: fields });
  }
}

@Injectable()
export class AdminProfileRepository implements AdminProfileRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * `RepeatableRead`로 격리 수준을 명시한다 — `findTarget`(read)과 이어지는
   * write 사이에 다른 트랜잭션이 끼어들어 감사 로그의 before 스냅샷이 stale해지는
   * 창을 닫는다. `applications.repository.ts`가 같은 read-then-write 위험에 이미
   * 같은 방식으로 대응한 전례를 따른다.
   *
   * actor 권한 검증도 이 트랜잭션 **안에서** 한다(#687). 첫 문장이 `lockActiveAdmins`이므로
   * 스냅샷도 그 시점에 잡힌다 — 그 전에 커밋된 강등은 그대로 보여 `ROL_004`로 거부되고,
   * 잠금을 기다리는 동안 커밋된 강등은 `RepeatableRead`가 직렬화 실패로 트랜잭션을
   * 통째로 되돌린다. 어느 쪽이든 낡은 권한으로 쓰기가 완주되지는 않는다.
   */
  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (transaction) =>
        operation(new PrismaAdminProfileTransactionStore(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

function toAdminProfileTargetRecord(
  user: PrismaAdminProfileTarget,
): AdminProfileTargetRecord {
  const profile = resolveCompatibleProfile(user);
  return { id: user.id, githubLogin: user.nickname, ...profile };
}
