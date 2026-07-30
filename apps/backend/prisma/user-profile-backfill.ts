import { Prisma, PrismaClient } from '@prisma/client';
import { isValidCompleteUserProfileFields } from '../src/users/user-profile-policy';

export const USER_PROFILE_BACKFILL_ERROR_KIND = {
  IMPOSSIBLE_PARTIAL: 'IMPOSSIBLE_PARTIAL',
  INVALID_COMPLETE: 'INVALID_COMPLETE',
  DUPLICATE_STUDENT_ID: 'DUPLICATE_STUDENT_ID',
  PROFILE_MISMATCH: 'PROFILE_MISMATCH',
} as const;

export type UserProfileBackfillErrorKind =
  (typeof USER_PROFILE_BACKFILL_ERROR_KIND)[keyof typeof USER_PROFILE_BACKFILL_ERROR_KIND];

export class UserProfileBackfillInvariantError extends Error {
  constructor(
    readonly kind: UserProfileBackfillErrorKind,
    readonly userIds: readonly string[],
  ) {
    super(`UserProfile backfill invariant failed: ${kind}`);
    this.name = 'UserProfileBackfillInvariantError';
  }
}

type CompleteProfileFields = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

type LegacyProfileState =
  | { readonly kind: 'EXPECTED_INCOMPLETE' }
  | { readonly kind: 'COMPLETE'; readonly fields: CompleteProfileFields }
  | { readonly kind: 'INVALID_COMPLETE' }
  | { readonly kind: 'IMPOSSIBLE_PARTIAL' };

export function classifyLegacyProfile(row: {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}): LegacyProfileState {
  if (row.studentId === null && row.department === null) {
    return { kind: 'EXPECTED_INCOMPLETE' };
  }
  if (row.name !== null && row.studentId !== null && row.department !== null) {
    const fields = {
      name: row.name,
      studentId: row.studentId,
      department: row.department,
    };
    if (!isValidCompleteUserProfileFields(fields)) {
      return { kind: 'INVALID_COMPLETE' };
    }
    return {
      kind: 'COMPLETE',
      fields,
    };
  }
  return { kind: 'IMPOSSIBLE_PARTIAL' };
}

export async function backfillUserProfiles(
  prisma: PrismaClient,
): Promise<number> {
  return prisma.$transaction(
    async (transaction) => {
      const users = await transaction.user.findMany({
        select: {
          id: true,
          name: true,
          studentId: true,
          department: true,
          profile: {
            select: {
              name: true,
              studentId: true,
              department: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      });
      const candidates: Array<{
        readonly userId: string;
        readonly fields: CompleteProfileFields;
      }> = [];
      const studentIdOwners = new Map<string, string>();

      for (const user of users) {
        const state = classifyLegacyProfile(user);
        if (state.kind === 'IMPOSSIBLE_PARTIAL') {
          throw new UserProfileBackfillInvariantError(
            USER_PROFILE_BACKFILL_ERROR_KIND.IMPOSSIBLE_PARTIAL,
            [user.id],
          );
        }
        if (state.kind === 'INVALID_COMPLETE') {
          throw new UserProfileBackfillInvariantError(
            USER_PROFILE_BACKFILL_ERROR_KIND.INVALID_COMPLETE,
            [user.id],
          );
        }
        if (state.kind === 'EXPECTED_INCOMPLETE') {
          if (user.profile !== null) {
            throw new UserProfileBackfillInvariantError(
              USER_PROFILE_BACKFILL_ERROR_KIND.PROFILE_MISMATCH,
              [user.id],
            );
          }
          continue;
        }

        const existingOwner = studentIdOwners.get(state.fields.studentId);
        if (existingOwner !== undefined) {
          throw new UserProfileBackfillInvariantError(
            USER_PROFILE_BACKFILL_ERROR_KIND.DUPLICATE_STUDENT_ID,
            [existingOwner, user.id],
          );
        }
        studentIdOwners.set(state.fields.studentId, user.id);

        if (user.profile !== null) {
          if (
            user.profile.name !== state.fields.name ||
            user.profile.studentId !== state.fields.studentId ||
            user.profile.department !== state.fields.department
          ) {
            throw new UserProfileBackfillInvariantError(
              USER_PROFILE_BACKFILL_ERROR_KIND.PROFILE_MISMATCH,
              [user.id],
            );
          }
          continue;
        }
        candidates.push({ userId: user.id, fields: state.fields });
      }

      if (candidates.length === 0) {
        return 0;
      }
      const created = await transaction.userProfile.createMany({
        data: candidates.map(({ userId, fields }) => ({ userId, ...fields })),
      });
      return created.count;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const created = await backfillUserProfiles(prisma);
    console.log(`[user-profile-backfill] created=${created}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('[user-profile-backfill] failed:', error);
    process.exitCode = 1;
  });
}
