import { Prisma } from '@prisma/client';
import type {
  CompatibleProfile,
  CompleteCompatibleProfile,
} from './profile-compatibility';

type CompletionTransaction = {
  readonly user: Pick<Prisma.TransactionClient['user'], 'updateMany'>;
  readonly userProfile: Pick<Prisma.TransactionClient['userProfile'], 'create'>;
};

type ProfileTransaction = {
  readonly user: Pick<
    Prisma.TransactionClient['user'],
    'updateMany' | 'update'
  >;
  readonly userProfile: Pick<
    Prisma.TransactionClient['userProfile'],
    'create' | 'update' | 'upsert'
  >;
};

type ExpectedLegacyProfile = CompatibleProfile & {
  readonly id: string;
};

type MutableProfileFields = {
  readonly name: string;
  readonly department: string;
};

export async function completeCompatibleProfileIfUnchanged(
  transaction: CompletionTransaction,
  expected: ExpectedLegacyProfile,
  profile: CompleteCompatibleProfile,
): Promise<boolean> {
  const updated = await transaction.user.updateMany({
    where: {
      id: expected.id,
      name: expected.name,
      studentId: expected.studentId,
      department: expected.department,
    },
    data: profile,
  });
  if (updated.count !== 1) {
    return false;
  }
  try {
    await transaction.userProfile.create({
      data: { userId: expected.id, ...profile },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return false;
    }
    throw error;
  }
  return true;
}

export async function updateCompatibleProfileFields(
  transaction: ProfileTransaction,
  userId: string,
  fields: MutableProfileFields,
): Promise<void> {
  await transaction.userProfile.update({ where: { userId }, data: fields });
  await transaction.user.update({ where: { id: userId }, data: fields });
}

export async function upsertCompatibleProfile(
  transaction: ProfileTransaction,
  userId: string,
  profile: CompleteCompatibleProfile,
): Promise<void> {
  await transaction.userProfile.upsert({
    where: { userId },
    update: profile,
    create: { userId, ...profile },
  });
  await transaction.user.update({ where: { id: userId }, data: profile });
}
