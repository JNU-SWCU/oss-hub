import { PrismaService } from '../../prisma/prisma.service';
import {
  UsersRepository,
  type RecordPhoneAudit,
  type RecordStaffNumberAudit,
} from './users.repository';
import type { UserProfileRecord } from '../domain/user-profile-policy';
import { profileRecord } from '../service/member-authority-test-fixtures';

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
  const auditLogCreate = jest.fn();
  const recordPhoneAudit = jest
    .fn<Promise<void>, Parameters<RecordPhoneAudit>>()
    .mockResolvedValue(undefined);
  const recordStaffNumberAudit = jest
    .fn<Promise<void>, Parameters<RecordStaffNumberAudit>>()
    .mockResolvedValue(undefined);

  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        phone: current.phone ?? null,
        staffNumber: current.staffNumber ?? null,
        memberKind: current.memberKind ?? null,
      },
    ]),
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
    auditLog: { create: auditLogCreate },
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
    auditLogCreate,
    recordPhoneAudit,
    recordStaffNumberAudit,
    transaction,
    repository: new UsersRepository(prisma),
  };
}

type InvocationOrders = {
  readonly mock: { readonly invocationCallOrder: readonly number[] };
};

export function callOrder(mock: InvocationOrders, index = 0): number {
  const order = mock.mock.invocationCallOrder.at(index);
  if (order === undefined) {
    throw new TypeError('Expected the mocked call to have happened.');
  }
  return order;
}

function toRow(record: UserProfileRecord) {
  return {
    id: record.id,
    githubId: record.githubId,
    nickname: record.githubLogin,
    phone: record.phone ?? null,
    selectedMemberKind: record.selectedMemberKind ?? null,
    hasStaffAccess: record.hasStaffAccess ?? false,
    hasAdminAccess: record.hasAdminAccess ?? false,
    profile:
      record.memberKind && record.affiliationKind && record.affiliationName
        ? {
            name: record.name ?? '',
            studentId: record.studentId,
            staffNumber: record.staffNumber ?? null,
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
