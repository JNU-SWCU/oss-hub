import { AccountStatus, Prisma, Role } from '@prisma/client';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import type { AdminAccessActor } from './admin-access.repository.types';

/**
 * 관리자 쓰기 경로가 공유하는 **actor 잠금·조회 원시**다.
 *
 * 관리자 권한 변경(`admin-access-mutation.service.ts`)과 관리자 프로필 대리 수정
 * (`admin-profile-mutation.service.ts`)은 서로 다른 트랜잭션 스토어를 쓰지만, actor가
 * 여전히 활성 ADMIN인지 판정하는 방식은 한 벌이어야 한다 — 두 벌로 갈라지면 한쪽만
 * 고쳐진 채로 #687의 TOCTOU 창이 다시 열린다.
 *
 * **잠금 순서**: 활성 ADMIN 집합(id 오름차순) → 개별 대상 행. actor 행을 먼저 잠그면
 * 이 순서가 뒤집혀, 두 관리자가 서로를 동시에 정리할 때 교착한다.
 *
 * 본인 계정 비활성화(`account-deactivation.service.ts`)는 actor를 재검증하지 않지만
 * 마지막 활성 ADMIN 불변식 때문에 **같은 집합을 같은 순서로** 잠근다 — 그래서 그 경로도
 * SQL을 따로 쓰지 않고 `lockActiveAdminRows`를 부른다. 잠금 순서 규칙이 두 벌로 갈라지는
 * 것 자체가 교착의 원인이다(`common/AGENTS.md`의 `milestone-document-locks.ts` 항목과 같은 이유).
 */
export const ADMIN_ACTOR_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  role: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_NAME_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminActor = Prisma.UserGetPayload<{
  select: typeof ADMIN_ACTOR_SELECT;
}>;

type LockedUserRow = Readonly<{ id: string }>;

/** Prisma가 `$queryRaw` 실패를 감쌀 때 쓰는 코드. 원래 코드는 `meta.code`에 들어간다. */
const RAW_QUERY_FAILED_CODE = 'P2010';
/** Postgres `serialization_failure`. */
const POSTGRES_SERIALIZATION_FAILURE = '40001';
/** Prisma가 직렬화 실패에 쓰는 표준 코드 — 공용 재시도가 이것만 알아본다. */
const PRISMA_SERIALIZATION_FAILURE_CODE = 'P2034';

/**
 * 활성 ADMIN 행을 전부 `FOR UPDATE`로 잠그고 그 수를 돌려준다.
 *
 * 돌아온 뒤에는 이 트랜잭션이 끝날 때까지 아무도 그 행들을 바꿀 수 없다 — actor 권한
 * 재검증은 **이 호출 뒤에** 해야 의미가 있다(#687).
 */
export async function lockActiveAdminRows(
  transaction: Prisma.TransactionClient,
): Promise<number> {
  try {
    const rows = await transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`
        SELECT id
        FROM "User"
        WHERE role = ${Role.ADMIN}::"Role"
          AND "accountStatus" = ${AccountStatus.ACTIVE}::"AccountStatus"
        ORDER BY id
        FOR UPDATE
      `,
    );
    return rows.length;
  } catch (error: unknown) {
    throw normalizeSerializationFailure(error);
  }
}

/**
 * 직렬화 실패를 Prisma의 **표준 모양(P2034)으로 되돌린다.**
 *
 * `RepeatableRead` 트랜잭션에서 이 `FOR UPDATE`가 대기하다 상대가 커밋하면 Postgres는
 * `40001`을 낸다. 그런데 `$queryRaw`로 나온 실패는 Prisma가 P2034가 아니라 **P2010**
 * (`Raw query failed`)으로 감싸고 원래 코드는 `meta.code`에 넣는다. 그래서 공용
 * `withSerializationRetry`(`common/prisma-serialization-retry.ts`)의 P2034 판정에 걸리지
 * 않고, 재시도 없이 raw Prisma 에러가 그대로 500으로 새어 나간다 — 실제로 그렇게 새는
 * 것을 `admin-actor-toctou.integration.spec.ts`의 프로필 거부 시험이 잡아냈다.
 *
 * 여기서 코드만 P2034로 바꿔 주면 그 공용 재시도가 제 일을 한다. 판정을 공용 쪽에
 * 넓히지 않는 이유는 `common/`이 이 레인의 수정 대상이 아니기 때문이다
 * (`apps/backend/src/common/AGENTS.md`: 「새 모듈은 이 파일들을 참조만 하고 수정하지
 * 않는다」). 공용 판정을 고치는 편이 더 낫다고 보면 그건 독립 PR 감이다.
 */
function normalizeSerializationFailure(error: unknown): unknown {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== RAW_QUERY_FAILED_CODE
  ) {
    return error;
  }
  const meta = error.meta as { readonly code?: string } | undefined;
  if (meta?.code !== POSTGRES_SERIALIZATION_FAILURE) {
    return error;
  }
  return new Prisma.PrismaClientKnownRequestError(error.message, {
    code: PRISMA_SERIALIZATION_FAILURE_CODE,
    clientVersion: error.clientVersion,
    meta: error.meta,
  });
}

export async function findAdminActorByGithubId(
  transaction: Prisma.TransactionClient,
  githubId: bigint,
): Promise<AdminAccessActor | null> {
  const actor = await transaction.user.findUnique({
    where: { githubId },
    select: ADMIN_ACTOR_SELECT,
  });
  return actor ? toAdminActor(actor) : null;
}

export function toAdminActor(user: PrismaAdminActor): AdminAccessActor {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: resolveCompatibleProfileName(user),
    role: user.role,
    accountStatus: user.accountStatus,
  };
}
