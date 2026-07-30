import { Prisma } from '@prisma/client';
import { completeCompatibleProfileIfUnchanged } from './profile-compatibility.repository';

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
  const completion = completeCompatibleProfileIfUnchanged(
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
  const completion = completeCompatibleProfileIfUnchanged(
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
