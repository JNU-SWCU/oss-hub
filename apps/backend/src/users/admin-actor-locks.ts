import { AccountStatus, Prisma } from '@prisma/client';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import { authorityLabel } from '../common/authority-label';
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
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  ...USER_PROFILE_NAME_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminActor = Prisma.UserGetPayload<{
  select: typeof ADMIN_ACTOR_SELECT;
}>;

type LockedUserRow = Readonly<{ id: string }>;

/**
 * 활성 ADMIN 행을 전부 `FOR UPDATE`로 잠그고 그 수를 돌려준다.
 *
 * 돌아온 뒤에는 이 트랜잭션이 끝날 때까지 아무도 그 행들을 바꿀 수 없다 — actor 권한
 * 재검증은 **이 호출 뒤에** 해야 의미가 있다(#687).
 *
 * **세는 기준은 `hasAdminAccess`다.** 계약 마이그레이션이 legacy `role`을 지운 뒤로는
 * 그 칸이 관리자 권한의 유일한 정본이고, 관리자 권한을 옮기는 모든 경로가 그 칸만
 * 쓴다(`admin-access-authority-write.ts`·`independent-authority.service.ts`). 두 칸이
 * 갈라질 수 있던 호환 구간은 끝났으므로 여기서 세는 집합과 전이가 바꾸는 집합이 같다.
 *
 * `RepeatableRead` 트랜잭션에서 이 잠금이 대기하다 상대가 커밋하면 Postgres가 `40001`을
 * 내고 Prisma는 그걸 `P2010`으로 감싼다. 그 모양을 알아보는 일은 공용
 * `isSerializationFailure`(`common/prisma-serialization-retry.ts`)가 한다 — 예전에는
 * 여기서 코드를 `P2034`로 되돌리는 우회를 뒀지만, 판정이 공용으로 옮겨가 지웠다(#822).
 */
export async function lockActiveAdminRows(
  transaction: Prisma.TransactionClient,
): Promise<number> {
  const rows = await transaction.$queryRaw<readonly LockedUserRow[]>(
    Prisma.sql`
        SELECT id
        FROM "User"
        WHERE "hasAdminAccess" = TRUE
          AND "accountStatus" = ${AccountStatus.ACTIVE}::"AccountStatus"
        ORDER BY id
        FOR UPDATE
      `,
  );
  return rows.length;
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

/** actor 행을 canonical 접근 권한과 함께 읽어 온다. */
export function toAdminActor(user: PrismaAdminActor): AdminAccessActor {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: resolveUserProfileName(user),
    role: authorityLabel({
      memberKind: user.selectedMemberKind,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
    }),
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    accountStatus: user.accountStatus,
  };
}
