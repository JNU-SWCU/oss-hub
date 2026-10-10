import { Prisma } from '@prisma/client';
import { fillStudentIdIfEmpty } from './user-profile-write';

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
      : jest.fn().mockResolvedValue({ count: options.updatedCount ?? 1 });
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
    const { transaction, updateMany } = harness();

    const outcome = await fillStudentIdIfEmpty(transaction, userId, studentId);

    expect(outcome).toBe('filled');
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId, studentId: null },
      data: { studentId },
    });
  });

  it('다른 계정이 그 학번을 쓰고 있으면 쓰지 않고 taken을 알린다', async () => {
    const { transaction, updateMany } = harness({
      owner: { userId: 'other-user' },
    });

    const outcome = await fillStudentIdIfEmpty(transaction, userId, studentId);

    expect(outcome).toBe('taken');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('자기 자신이 이미 그 학번을 가지고 있으면 최초 저장이 아니다', async () => {
    const { transaction } = harness({ owner: { userId } });

    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).resolves.toBe('conflict');
  });

  it('같은 계정을 다른 요청이 먼저 채웠으면 conflict로 멈춘다', async () => {
    const { transaction } = harness({ updatedCount: 0 });

    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).resolves.toBe('conflict');
  });

  it('조회와 쓰기 사이에 끼어든 동시 저장은 제약이 잡아 taken이 된다', async () => {
    const { transaction } = harness({ updateError: uniqueConstraintError() });

    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).resolves.toBe('taken');
  });

  it('unique 충돌이 아닌 오류는 그대로 던진다', async () => {
    const failure = new TypeError('synthetic profile update failure');
    const { transaction } = harness({ updateError: failure });

    await expect(
      fillStudentIdIfEmpty(transaction, userId, studentId),
    ).rejects.toBe(failure);
  });
});
