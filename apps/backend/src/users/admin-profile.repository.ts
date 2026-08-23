import { Inject, Injectable } from '@nestjs/common';
import { AffiliationKind, MemberKind, Prisma } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { DomainException } from '../common/error-code';
import { withSerializationRetry } from '../common/prisma-serialization-retry';
import {
  USER_PROFILE_SELECT,
  resolveUserProfile,
} from '../profiles/user-profile-read';
import { upsertUserProfile } from '../profiles/user-profile-write.repository';
import { PrismaService } from '../prisma/prisma.service';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
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
  ...USER_PROFILE_SELECT,
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
   * `upsertUserProfile`(#profiles/user-profile-write.repository)을 그대로
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
      await upsertUserProfile(
        this.transaction,
        userId,
        {
          ...fields,
          // 학번이 실린 프로필은 학생이다 — 계약 CHECK가 그 대응을 강제한다
          // (`UserProfile_studentId_memberKind_check`).
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: fields.department,
        },
        withAffiliationName(changedFields),
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

  /**
   * 학번이 없는(그리고 앞으로도 없을) 계정의 이름·소속만 고친다.
   *
   * 프로필 행이 없으면 조용히 넘어간다 — 아직 가입을 마치지 않은 사람에게 관리자가
   * 이름만 붙여 반쪽짜리 프로필을 만들 수는 없다(세 canonical 칸이 NOT NULL이다).
   */
  async applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) {
      return;
    }
    await this.transaction.userProfile.updateMany({
      where: { userId },
      data: withAffiliationName(fields),
    });
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
   * `RepeatableRead`는 같은 행을 건드리는 동시 트랜잭션끼리 Postgres 직렬화
   * 충돌(P2034)을 낼 수 있다 — 서로 다른 필드를 고치는 두 관리자가 그 예다.
   * `withSerializationRetry`가 트랜잭션 전체(before 재조회 포함)를 다시 돌려
   * 흡수하고, 그래도 안 되면 원시 Prisma 에러 대신 409
   * `PROFILE_UPDATE_CONFLICT`로 바꿔 던진다.
   *
   * actor 권한 검증도 이 트랜잭션 **안에서** 한다(#687). 첫 문장이 `lockActiveAdmins`이므로
   * 스냅샷도 그 시점에 잡힌다 — 그 전에 커밋된 강등은 그대로 보여 `ROL_004`로 거부된다.
   * 잠금을 기다리는 동안 강등이 커밋되면 `RepeatableRead`가 스냅샷을 지킬 수 없어
   * P2034로 되돌리는데, 그건 위 재시도가 새 스냅샷으로 다시 돌려 앞의 경우로 만든다.
   * 어느 경로로도 낡은 권한으로 쓰기가 완주하지 않는다.
   *
   * ⚠ 이 잠금은 활성 ADMIN **전체**를 잡는다. 이 경로엔 「마지막 활성 관리자」 불변식이
   * 없고, 잠그는 이유는 오직 잠금 순서 규칙을 권한 변경 경로와 한 벌로 두기 위함이다
   * (원본: `admin-actor-locks.ts`). 그 대가로 관리자 프로필을 동시에 고치는 평범한 두
   * 요청도 위 재시도 경로를 타고, 경합이 이어지면 409가 나갈 수 있다.
   */
  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation(new PrismaAdminProfileTransactionStore(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        ),
      {
        onExhausted: () =>
          new DomainException(
            USERS_ERROR_CODES[UsersErrorCode.PROFILE_UPDATE_CONFLICT],
          ),
      },
    );
  }
}

function toAdminProfileTargetRecord(
  user: PrismaAdminProfileTarget,
): AdminProfileTargetRecord {
  const profile = resolveUserProfile(user);
  return { id: user.id, githubLogin: user.nickname, ...profile };
}

/**
 * `department`를 고칠 때 `affiliationName`도 함께 옮긴다.
 *
 * 두 칸은 같은 사실의 두 사본이라 한쪽만 쓰면 계약 CHECK가 거부한다
 * (`UserProfile_department_affiliationName_check`).
 */
function withAffiliationName<T extends { readonly department?: string }>(
  fields: T,
): T & { readonly affiliationName?: string } {
  return fields.department === undefined
    ? fields
    : { ...fields, affiliationName: fields.department };
}
