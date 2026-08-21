import { Prisma, PrismaClient } from '@prisma/client';
import {
  isCompatibleCanonicalProfile,
  type CanonicalProfileCompatibilitySource,
} from '../src/profiles/member-authority-compatibility';
import {
  effectiveProfileRole,
  isCompleteProfileFields,
  isValidCompleteUserProfileFields,
  type UserProfileRecord,
} from '../src/users/user-profile-policy';

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
  | { readonly kind: 'LEGACY_ONLY_COMPLETE' }
  | { readonly kind: 'COMPLETE'; readonly fields: CompleteProfileFields }
  | { readonly kind: 'INVALID_COMPLETE' }
  | { readonly kind: 'IMPOSSIBLE_PARTIAL' };

type LegacyProfileInput = Pick<
  UserProfileRecord,
  | 'name'
  | 'studentId'
  | 'department'
  | 'role'
  | 'selectedRole'
  | 'hasPendingStaffRequest'
>;

type CanonicalBackfillUser = CanonicalProfileCompatibilitySource & {
  readonly id: string;
  readonly roleRequests: readonly { readonly id: string }[];
};

export function classifyLegacyProfile(
  row: LegacyProfileInput,
): LegacyProfileState {
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

  // STAFF/ADMIN은 학번 없이도 역할 기준으로 완료될 수 있다. 그 정상 상태를
  // UserProfile로 옮기려 하면 NOT NULL·unique인 studentId를 채울 방법이 없으므로,
  // legacy User 컬럼에 그대로 둔다. 역할 근거가 없으면 정책의 fail-closed 학생
  // 기준을 적용하므로 학번 없는 학생/미배정 부분 프로필은 이 분기를 통과하지 않는다.
  if (
    row.studentId === null &&
    isCompleteProfileFields(row, effectiveProfileRole(row))
  ) {
    return { kind: 'LEGACY_ONLY_COMPLETE' };
  }
  if (row.studentId === null && row.department === null) {
    return { kind: 'EXPECTED_INCOMPLETE' };
  }
  return { kind: 'IMPOSSIBLE_PARTIAL' };
}

export interface BackfillUserProfilesOptions {
  /**
   * 지정하면 이 접두사로 시작하는 User.id만 backfill 대상으로 스캔한다.
   * production에서 실행되는 demo profile 예외(`seed.ts`)가 `seed:demo:`로 스코프해,
   * 이미 존재하는 비-demo production 사용자의 legacy 프로필(PROFILE_MISMATCH 등)이
   * demo 시드 실행을 실패시키거나 그 행을 건드리지 않게 한다. 생략하면 기존과 동일하게
   * 전체 User를 대상으로 한다 — 다른 모든 profile의 동작은 바뀌지 않는다.
   */
  readonly userIdPrefix?: string;
}

export async function backfillUserProfiles(
  prisma: PrismaClient,
  options: BackfillUserProfilesOptions = {},
): Promise<number> {
  const { userIdPrefix } = options;
  return prisma.$transaction(
    async (transaction) => {
      const users = await transaction.user.findMany({
        where:
          userIdPrefix !== undefined
            ? { id: { startsWith: userIdPrefix } }
            : undefined,
        select: {
          id: true,
          name: true,
          studentId: true,
          department: true,
          role: true,
          selectedRole: true,
          selectedMemberKind: true,
          hasStaffAccess: true,
          hasAdminAccess: true,
          roleRequests: {
            where: { status: 'PENDING' },
            select: { id: true },
            take: 1,
          },
          profile: {
            select: {
              name: true,
              studentId: true,
              department: true,
              memberKind: true,
              affiliationKind: true,
              affiliationName: true,
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
        const state = classifyLegacyProfile({
          name: user.name,
          studentId: user.studentId,
          department: user.department,
          role: user.role,
          selectedRole: user.selectedRole,
          hasPendingStaffRequest: user.roleRequests.length > 0,
        });
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
        if (
          state.kind === 'EXPECTED_INCOMPLETE' ||
          state.kind === 'LEGACY_ONLY_COMPLETE'
        ) {
          if (hasLegacyOnlyProfileMismatch(user)) {
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

        if (matchesCompleteLegacyProfile(user, state.fields)) {
          continue;
        }
        if (user.profile !== null) {
          throw new UserProfileBackfillInvariantError(
            USER_PROFILE_BACKFILL_ERROR_KIND.PROFILE_MISMATCH,
            [user.id],
          );
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

function hasLegacyOnlyProfileMismatch(user: CanonicalBackfillUser): boolean {
  return user.profile !== null && !isCompatibleCanonicalProfile(user);
}

function matchesCompleteLegacyProfile(
  user: CanonicalBackfillUser,
  fields: CompleteProfileFields,
): boolean {
  return (
    user.profile !== null &&
    user.profile.name === fields.name &&
    user.profile.studentId === fields.studentId &&
    user.profile.department === fields.department
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
