import { Prisma } from '@prisma/client';
import type { AffiliationKind, MemberKind } from '@prisma/client';

type ProfileTransaction = {
  readonly userProfile: Pick<
    Prisma.TransactionClient['userProfile'],
    'create' | 'update' | 'updateMany' | 'upsert' | 'findUnique'
  >;
};

export type UserProfileWrite = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

export type UserProfilePatch = {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
};

export type StudentIdFillOutcome = 'filled' | 'conflict' | 'taken';

export async function fillStudentIdIfEmpty(
  transaction: ProfileTransaction,
  userId: string,
  studentId: string,
): Promise<StudentIdFillOutcome> {
  const owner = await transaction.userProfile.findUnique({
    where: { studentId },
    select: { userId: true },
  });
  if (owner !== null) {
    return owner.userId === userId ? 'conflict' : 'taken';
  }

  try {
    const updated = await transaction.userProfile.updateMany({
      where: { userId, studentId: null },
      data: { studentId },
    });
    return updated.count === 1 ? 'filled' : 'conflict';
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return 'taken';
    }
    throw error;
  }
}

export async function upsertUserProfile(
  transaction: ProfileTransaction,
  userId: string,
  profile: UserProfileWrite,
  patch: UserProfilePatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) {
    return;
  }
  await transaction.userProfile.upsert({
    where: { userId },
    update: patch,
    create: { userId, ...profile },
  });
}
