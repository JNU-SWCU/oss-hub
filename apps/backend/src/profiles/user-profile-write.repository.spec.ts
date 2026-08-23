import { Prisma } from '@prisma/client';
import { fillStudentIdIfEmpty } from './user-profile-write.repository';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.6.0',
  });
}

describe('학번 최초 저장', () => {
  const userId = 'synthetic-user';
  const studentId = '153405';

  function harness(
    options: {
      readonly owner?: { readonly userId: string } | null;
      readonly updatedCount?: number;
      readonly updateError?: unknown;
    } = {},
  ) {
    const findUnique = jest.fn().mockResolvedValue(options.owner ?? null);
    const updateMany = options.updateError
      ? jest.fn().mockRejectedValue(options.updateError)
      : jest
          .fn()
          .mockResolvedValue({ count: options.updatedCount ?? 1 });
    return {
      findUnique,
      updateMany,
      transaction: {
        userProfile: {
          create: jest.fn(),
          update: jest.fn(),
          upsert: jest.fn(),
          updateMany,
          findUnique,
        },
      },
    };
  }

  it('학번이 비어 있던 프로필에 제약 아래로 학번을 넣는다', async () => {
    // Given — `UserProfile.studentId`의 unique 제약이 유일성의 유일한 근거다
    const { transaction, updateMany } = harness();

    // When
    const outcome = await fillStudentIdIfEmpty(transaction, userId, studentId);

    // Then — `studentId: null` 조건이 CAS다: 그 사이 누가 채웠으면 0행이 된다
    expect(outcome).toBe('filled');
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId, studentId: null },
      data: { studentId },
    });
  });

  it('다른 계정이 그 학번을 쓰고 있으면 쓰지 않고 taken을 알린다', async () => {
    // Given
    const { transaction, updateMany } = harness({
      owner: { userId: 'other-user' },
    });

    // When
    const outcome = await fillStudentIdIfEmpty(transaction, userId, studentId);

    // Then — 재시도해도 소용없는 실패라 사용자에게 다르게 말해야 한다
    expect(outcome).toBe('taken');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('자기 자신이 이미 그 학번을 가지고 있으면 최초 저장이 아니다', async () => {
    // Given
    const { transaction } = harness({ owner: { userId } });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).resolves.toBe('conflict');
  });

  it('같은 계정을 다른 요청이 먼저 채웠으면 conflict로 멈춘다', async () => {
    // Given — CAS가 0행을 갱신한다
    const { transaction } = harness({ updatedCount: 0 });

    // When / Then — 조용히 덮어쓰지 않고 다시 읽으라고 알린다
    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).resolves.toBe('conflict');
  });

  it('조회와 쓰기 사이에 끼어든 동시 저장은 제약이 잡아 taken이 된다', async () => {
    // Given — 소유자 조회는 비어 있었지만 그 사이 다른 요청이 같은 학번을 넣었다
    const { transaction } = harness({ updateError: uniqueConstraintError() });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).resolves.toBe('taken');
  });

  it('unique 충돌이 아닌 오류는 그대로 던진다', async () => {
    // Given
    const failure = new TypeError('synthetic profile update failure');
    const { transaction } = harness({ updateError: failure });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).rejects.toBe(failure);
  });
});
