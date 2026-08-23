import { Prisma } from '@prisma/client';
import type { AffiliationKind, MemberKind } from '@prisma/client';

type ProfileTransaction = {
  readonly userProfile: Pick<
    Prisma.TransactionClient['userProfile'],
    'create' | 'update' | 'updateMany' | 'upsert' | 'findUnique'
  >;
};

/**
 * `UserProfile` 행을 새로 만들 때 필요한 값 전부.
 *
 * 세 canonical 컬럼(`memberKind`·`affiliationKind`·`affiliationName`)이 NOT NULL이라
 * 새 행을 만드는 호출부는 이 값들을 반드시 알고 있어야 한다.
 */
export type UserProfileWrite = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

/**
 * 이미 있는 행에서 바꿀 수 있는 항목. 커맨드에 실제로 실린 필드만 담는다.
 *
 * `department`와 `affiliationName`은 같은 사실의 두 사본이므로
 * (`UserProfile_department_affiliationName_check`) 한쪽만 바꿀 수 없다.
 */
export type UserProfilePatch = {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
};

/**
 * 학번 최초 저장의 결과.
 *
 * - `filled`: 학번이 유일성 제약 아래 들어갔다.
 * - `conflict`: 같은 계정을 다른 요청이 먼저 바꿨다(CAS miss). 다시 읽고 판단해야 한다.
 * - `taken`: 다른 계정이 이미 그 학번을 쓰고 있다. 재시도해도 달라지지 않는다.
 */
export type StudentIdFillOutcome = 'filled' | 'conflict' | 'taken';

/**
 * 아직 학번이 없는 계정에 학번을 처음 채워 넣는다.
 *
 * 학번의 유일성을 보증하는 것은 `UserProfile.studentId`의 unique 제약 하나뿐이므로,
 * 학번이 실리는 쓰기는 예외 없이 이 경로를 지난다.
 *
 * 먼저 소유자를 조회하는 것은 원인을 정확히 알려 주기 위해서다(재시도해도 소용없는
 * `taken`과 다시 읽으면 되는 `conflict`는 사용자에게 할 말이 다르다). 보증은 여전히
 * 제약이 한다 — 조회와 쓰기 사이에 끼어든 요청은 P2002로 잡힌다.
 */
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
    // 자기 자신이 소유자면 학번은 이미 채워져 있다 — 최초 저장이 아니므로 다시 읽어야 한다.
    return owner.userId === userId ? 'conflict' : 'taken';
  }

  try {
    // `studentId: null` 조건이 CAS다 — 그 사이에 누가 채웠으면 0행이 되어
    // 조용히 덮어쓰지 않고 `conflict`로 돌아온다.
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
      // 조회와 쓰기 사이에 다른 계정이 같은 학번을 가져갔다.
      return 'taken';
    }
    throw error;
  }
}

/**
 * 프로필을 만들거나 고친다.
 *
 * `patch`가 비어 있으면 아무것도 쓰지 않는다 — 관리자 두 명이 같은 사용자의 서로 다른
 * 필드를 거의 동시에 고칠 때, 커맨드에 없는 필드를 UPDATE 문에 실으면 상대가 막
 * 저장한 값을 옛 값으로 되돌린다(lost-update, #787 리뷰).
 */
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
