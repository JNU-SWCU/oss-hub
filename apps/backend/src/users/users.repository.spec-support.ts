import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';
import type { UserProfileRecord } from './user-profile-policy';
import { profileRecord } from './member-authority-test-fixtures';

type TransactionCallback<T> = (transaction: unknown) => Promise<T>;

function prismaServiceWith(overrides: object): PrismaService {
  return Object.assign(new PrismaService(), overrides);
}

export function usersRepositoryHarness(
  current: UserProfileRecord = profileRecord('synthetic-user'),
) {
  const findUnique = jest.fn();
  const transactionFindUnique = jest.fn().mockResolvedValue(toRow(current));
  const userUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = jest.fn().mockResolvedValue({});
  const userProfileCreate = jest.fn().mockResolvedValue({});
  const userProfileUpsert = jest.fn().mockResolvedValue({});
  const userProfileUpdate = jest.fn().mockResolvedValue({});
  const userProfileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const userProfileFindUnique = jest.fn().mockResolvedValue(null);
  const staffAccessRequestFindFirst = jest.fn().mockResolvedValue(null);
  const staffAccessRequestCreate = jest
    .fn()
    .mockResolvedValue({ id: 'synthetic-request', status: 'PENDING' });
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUnique: transactionFindUnique,
      updateMany: userUpdateMany,
      update: userUpdate,
    },
    userProfile: {
      create: userProfileCreate,
      upsert: userProfileUpsert,
      update: userProfileUpdate,
      updateMany: userProfileUpdateMany,
      findUnique: userProfileFindUnique,
    },
    staffAccessRequest: {
      findFirst: staffAccessRequestFindFirst,
      create: staffAccessRequestCreate,
    },
  };
  const prisma = prismaServiceWith({
    user: { findUnique },
    userProfile: {
      findUnique: userProfileFindUnique,
      update: userProfileUpdate,
      updateMany: userProfileUpdateMany,
    },
    $transaction: <T>(callback: TransactionCallback<T>) =>
      callback(transaction),
  });
  return {
    findUnique,
    transactionFindUnique,
    userUpdateMany,
    userUpdate,
    userProfileCreate,
    userProfileUpsert,
    userProfileUpdate,
    userProfileUpdateMany,
    userProfileFindUnique,
    staffAccessRequestFindFirst,
    staffAccessRequestCreate,
    repository: new UsersRepository(prisma),
  };
}

function toRow(record: UserProfileRecord) {
  return {
    id: record.id,
    selectedMemberKind: record.selectedMemberKind ?? null,
    hasStaffAccess: record.hasStaffAccess ?? false,
    hasAdminAccess: record.hasAdminAccess ?? false,
    profile:
      record.memberKind && record.affiliationKind && record.affiliationName
        ? {
            name: record.name ?? '',
            studentId: record.studentId,
            department: record.department ?? record.affiliationName,
            memberKind: record.memberKind,
            affiliationKind: record.affiliationKind,
            affiliationName: record.affiliationName,
          }
        : null,
    staffAccessRequests: record.hasPendingStaffRequest
      ? [{ id: 'synthetic-pending-request' }]
      : [],
  };
}
