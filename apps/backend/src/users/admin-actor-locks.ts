import { AccountStatus, Prisma, Role } from '@prisma/client';
import { resolveMemberAuthorityCompatibility } from '../profiles/member-authority-compatibility';
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
  selectedRole: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_NAME_SELECT,
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
 * **세는 기준은 legacy `role`이다 — canonical `hasAdminAccess`가 아니다.** 이 잠금이
 * 지키는 불변식은 "활성 ADMIN **역할**이 최소 하나 남는다"이고, 그 불변식을 가지는
 * 전이는 `role`을 옮기는 legacy 경로뿐이다. 두 칸은 일부러 갈라질 수 있다 — #996이
 * 교직원과 관리자 권한 변경을 분리하면서 legacy 역할 변경이 canonical 권한을 지우지
 * **않도록** 했기 때문이다(`admin-access-authority-write.ts`). 그래서 ADMIN에서 STAFF로
 * 강등된 사람은 `role = STAFF`이면서 `hasAdminAccess = true`일 수 있다. 여기서
 * canonical 칸을 세면 이미 강등된 사람을 활성 관리자로 오해해 마지막 관리자 가드가
 * 끩는다(`admin-access.integration.spec.ts`의 경쟁 스펙이 그것을 잡는다).
 *
 * 독립 권한 경로(`independent-authority.service.ts`)가 canonical 칸의 유일한 주인이고,
 * 그쪽은 `role`과 canonical을 함께 옥긴다 — 그래서 이 집합은 양쪽 경로 모두에서
 * 일관되게 남는다.
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
        WHERE role = ${Role.ADMIN}::"Role"
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

/**
 * actor 행을 canonical 접근 권한과 함께 읽어 온다.
 *
 * `hasStaffAccess`·`hasAdminAccess`가 `NULL`인 backfill 이전 행은 compat 계층이 legacy
 * `role`에서 되살린다 — 그래야 인가 판정(`admin-access-authorization.ts`)이 두 세대의 행을
 * 같은 규칙으로 본다.
 */
export function toAdminActor(user: PrismaAdminActor): AdminAccessActor {
  const authority = resolveMemberAuthorityCompatibility({
    ...user,
    department: null,
    profile: null,
  });
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: resolveCompatibleProfileName(user),
    role: user.role,
    hasStaffAccess: authority.hasStaffAccess,
    hasAdminAccess: authority.hasAdminAccess,
    accountStatus: user.accountStatus,
  };
}
