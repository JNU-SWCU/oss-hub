import { Prisma } from '@prisma/client';
import {
  completeUserProfileViewIfUnchanged,
  fillStudentIdIfEmpty,
} from './user-profile-write.repository';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.6.0',
  });
}

it('treats a profile-create unique conflict as a compare-and-set miss', async () => {
  // Given
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const create = jest.fn().mockRejectedValue(uniqueConstraintError());
  const transaction = {
    user: { updateMany },
    userProfile: { create },
  };

  // When
  const completion = completeUserProfileViewIfUnchanged(
    transaction,
    {
      id: 'synthetic-user',
      name: '기존 이름',
      studentId: null,
      department: null,
    },
    {
      name: '새 이름',
      studentId: '153403',
      department: '인공지능학부',
    },
  );

  // Then
  await expect(completion).resolves.toBe(false);
  expect(updateMany).toHaveBeenCalledTimes(1);
});

it('rethrows profile-create failures other than unique conflicts', async () => {
  // Given
  const failure = new TypeError('synthetic profile create failure');
  const transaction = {
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    userProfile: { create: jest.fn().mockRejectedValue(failure) },
  };

  // When
  const completion = completeUserProfileViewIfUnchanged(
    transaction,
    {
      id: 'synthetic-user',
      name: '기존 이름',
      studentId: null,
      department: null,
    },
    {
      name: '새 이름',
      studentId: '153403',
      department: '인공지능학부',
    },
  );

  // Then
  await expect(completion).rejects.toBe(failure);
});

describe('학번 최초 저장', () => {
  const expected = {
    id: 'synthetic-user',
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
  };
  const profile = {
    name: '합성 교직원',
    studentId: '153405',
    department: '인공지능학부',
  };

  function harness(
    options: {
      readonly owner?: { readonly userId: string } | null;
      readonly updatedCount?: number;
      readonly createError?: unknown;
    } = {},
  ) {
    const findUnique = jest.fn().mockResolvedValue(options.owner ?? null);
    const updateMany = jest
      .fn()
      .mockResolvedValue({ count: options.updatedCount ?? 1 });
    const create = options.createError
      ? jest.fn().mockRejectedValue(options.createError)
      : jest.fn().mockResolvedValue({});
    return {
      findUnique,
      updateMany,
      create,
      transaction: {
        user: { updateMany },
        userProfile: { create, findUnique },
      },
    };
  }

  it('학번이 비어 있던 계정에 UserProfile 행을 만들어 제약 아래 넣는다', async () => {
    // Given — 구버전 User 컬럼에는 unique 제약이 없어 이 행이 유일성의 유일한 근거다
    const { transaction, updateMany, create } = harness();

    // When
    const outcome = await fillStudentIdIfEmpty(
      transaction,
      expected,
      profile,
    );

    // Then
    expect(outcome).toBe('filled');
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: expected.id,
        name: expected.name,
        studentId: null,
        department: expected.department,
      },
      data: profile,
    });
    expect(create).toHaveBeenCalledWith({
      data: { userId: expected.id, ...profile },
    });
  });

  it('다른 계정이 그 학번을 쓰고 있으면 쓰지 않고 taken을 알린다', async () => {
    // Given
    const { transaction, updateMany } = harness({
      owner: { userId: 'other-user' },
    });

    // When
    const outcome = await fillStudentIdIfEmpty(
      transaction,
      expected,
      profile,
    );

    // Then — 재시도해도 소용없는 실패라 사용자에게 다르게 말해야 한다
    expect(outcome).toBe('taken');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('자기 자신이 이미 그 학번을 가지고 있으면 최초 저장이 아니다', async () => {
    // Given
    const { transaction } = harness({ owner: { userId: expected.id } });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, expected, profile),
    ).resolves.toBe('conflict');
  });

  it('같은 계정을 다른 요청이 먼저 바꿨으면 conflict로 멈춘다', async () => {
    // Given — CAS가 0행을 갱신한다
    const { transaction, create } = harness({ updatedCount: 0 });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, expected, profile),
    ).resolves.toBe('conflict');
    expect(create).not.toHaveBeenCalled();
  });

  it('조회와 create 사이에 끼어든 동시 저장은 제약이 잡아 taken이 된다', async () => {
    // Given — 소유자 조회는 비어 있었지만 그 사이 다른 요청이 같은 학번을 넣었다
    const { transaction } = harness({ createError: uniqueConstraintError() });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, expected, profile),
    ).resolves.toBe('taken');
  });

  it('unique 충돌이 아닌 오류는 그대로 던진다', async () => {
    // Given
    const failure = new TypeError('synthetic profile create failure');
    const { transaction } = harness({ createError: failure });

    // When / Then
    await expect(
      fillStudentIdIfEmpty(transaction, expected, profile),
    ).rejects.toBe(failure);
  });
});
