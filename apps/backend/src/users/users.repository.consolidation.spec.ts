import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { UsersRepository } from './users.repository';
import { UserTransitionRepository } from './user-transition.repository';

function harness() {
  let profileCreatedAt: Date | null = new Date('2026-01-01');
  const row = () => ({
    id: 'user',
    githubId: 123n,
    nickname: 'synthetic',
    phone: '01012345678',
    type: 'STUDENT',
    name: 'Name',
    studentId: '123456',
    staffNumber: null,
    department: 'Department',
    departmentType: 'DEPARTMENT',
    profileCreatedAt,
    profileUpdatedAt: profileCreatedAt,
    admin: null,
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    approvalRequestedAt: null,
    approvalDecidedAt: null,
    approvalDecidedById: null,
    approvalReason: null,
  });
  const update = jest
    .fn()
    .mockImplementation((input: { data: Prisma.UserUpdateInput }) => {
      if (input.data.profileCreatedAt instanceof Date)
        profileCreatedAt = input.data.profileCreatedAt;
      return Promise.resolve(row());
    });
  const prisma = Object.assign(new PrismaService(), {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(row())),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(row())),
      update,
    },
    userHistory: { create: jest.fn().mockResolvedValue({}) },
  });
  Object.assign(prisma, {
    $transaction: <T>(operation: (transaction: PrismaService) => Promise<T>) =>
      operation(prisma),
  });
  return {
    repository: new UsersRepository(prisma, new UserTransitionRepository()),
    update,
  };
}

it('rejects staffNumber changes against the locked current STUDENT row', async () => {
  const { repository, update } = harness();
  const expected = await repository.findByGithubId(123n);
  if (!expected) throw new TypeError('Missing fixture user');

  await expect(
    repository.updateProfileFields(
      expected,
      { name: 'Name', department: 'Department', staffNumber: 'staff-number' },
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
    ),
  ).rejects.toMatchObject({ errorCode: { code: 'SYS_003', status: 400 } });
  expect(update).not.toHaveBeenCalled();
});
