import { Prisma } from '@prisma/client';
import type {
  CompatibleProfile,
  CompleteCompatibleProfile,
} from './profile-compatibility';

type CompletionTransaction = {
  readonly user: Pick<Prisma.TransactionClient['user'], 'updateMany'>;
  readonly userProfile: Pick<Prisma.TransactionClient['userProfile'], 'create'>;
};

type StudentIdFillTransaction = CompletionTransaction & {
  readonly userProfile: Pick<
    Prisma.TransactionClient['userProfile'],
    'create' | 'findUnique'
  >;
};

/**
 * 학번 최초 저장의 결과.
 *
 * - `filled`: UserProfile 행이 만들어졌고 학번이 유일성 제약 아래 들어갔다.
 * - `conflict`: 같은 계정을 다른 요청이 먼저 바꿨다(CAS miss). 다시 읽고 판단해야 한다.
 * - `taken`: 다른 계정이 이미 그 학번을 쓰고 있다. 재시도해도 달라지지 않는다.
 */
export type StudentIdFillOutcome = 'filled' | 'conflict' | 'taken';

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

/**
 * 아직 학번이 없는 계정에 학번을 처음 채워 넣는다 — 언제나 UserProfile 행을 만든다.
 *
 * 학번의 유일성을 실제로 보증하는 것은 `UserProfile.studentId`의 unique 제약 하나뿐이다.
 * 구버전 `User.studentId` 컬럼에는 제약이 없어서, UserProfile 행이 없는 계정(학번 없이
 * 완료된 교직원 등)에 대해 User 컬럼만 갱신하면 서로 다른 두 사람이 같은 학번을 갖게 되고
 * 동시 최초 저장 두 건이 모두 성공한다. 그래서 학번이 실리는 쓰기는 예외 없이 이 경로를
 * 지나 UserProfile 행을 만든다.
 *
 * 먼저 소유자를 조회하는 것은 원인을 정확히 알려 주기 위해서다(재시도해도 소용없는
 * `taken`과 다시 읽으면 되는 `conflict`는 사용자에게 할 말이 다르다). 보증은 여전히
 * 제약이 한다 — 조회와 create 사이에 끼어든 요청은 P2002로 잡힌다.
 */
export async function fillCompatibleStudentIdIfUnchanged(
  transaction: StudentIdFillTransaction,
  expected: ExpectedLegacyProfile,
  profile: CompleteCompatibleProfile,
): Promise<StudentIdFillOutcome> {
  const owner = await transaction.userProfile.findUnique({
    where: { studentId: profile.studentId },
    select: { userId: true },
  });
  if (owner !== null) {
    // 자기 자신이 소유자면 학번은 이미 채워져 있다 — 최초 저장이 아니므로 다시 읽어야 한다.
    return owner.userId === expected.id ? 'conflict' : 'taken';
  }

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
    return 'conflict';
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
      return 'taken';
    }
    throw error;
  }
  return 'filled';
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
