import { AccountStatus, Prisma } from '@prisma/client';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import { authorityLabel } from './domain/authority-label';
import type { AdminAccessActor } from './admin-access.repository.types';

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
