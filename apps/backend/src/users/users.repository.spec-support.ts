import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  UsersRepository,
  type RecordPhoneAudit,
  type RecordStaffNumberAudit,
} from './users.repository';
import { UserTransitionRepository } from './user-transition.repository';
import type { UserProfileRecord } from './profile-validation.config';
import { profileRecord } from './member-authority-test-fixtures';

type Row = User & { readonly admin: { readonly userId: string } | null };
export function usersRepositoryHarness(
  record: UserProfileRecord = profileRecord('synthetic-user'),
) {
  let current: Row | null = toRow(record);
  let takenStudentId: string | null = null;
  const histories: Prisma.UserHistoryCreateArgs['data'][] = [];
  const findUnique = jest
    .fn<Promise<Row | null>, [Prisma.UserFindUniqueArgs]>()
    .mockImplementation((args: Prisma.UserFindUniqueArgs) => {
      if (typeof args.where.studentId === 'string')
        return Promise.resolve(
          takenStudentId === args.where.studentId
            ? { ...toRow(record), id: 'other-user', studentId: takenStudentId }
            : current?.studentId === args.where.studentId
              ? current
              : null,
        );
      return Promise.resolve(current === null ? null : { ...current });
    });
  const findUniqueOrThrow = jest
    .fn()
    .mockImplementation(async (args: Prisma.UserFindUniqueArgs) => {
      const row = await findUnique(args);
      if (row === null) throw new Error('Missing user');
      return row;
    });
  const userUpdate = jest
    .fn()
    .mockImplementation((args: { data: Partial<Row> }) => {
      if (current === null) throw new Error('Missing user');
      if (
        args.data.studentId !== undefined &&
        args.data.studentId !== null &&
        args.data.studentId === takenStudentId
      )
        throw new Prisma.PrismaClientKnownRequestError('Duplicate studentId', {
          code: 'P2002',
          clientVersion: 'synthetic',
        });
      current = { ...current, ...args.data };
      return Promise.resolve({ ...current });
    });
  const historyCreate = jest
    .fn()
    .mockImplementation((args: Prisma.UserHistoryCreateArgs) => {
      histories.push(args.data);
      return Promise.resolve(args.data);
    });
  const recordPhoneAudit = jest
    .fn<Promise<void>, Parameters<RecordPhoneAudit>>()
    .mockResolvedValue(undefined);
  const recordStaffNumberAudit = jest
    .fn<Promise<void>, Parameters<RecordStaffNumberAudit>>()
    .mockResolvedValue(undefined);
  const transaction = Object.assign(new PrismaService(), {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique, findUniqueOrThrow, update: userUpdate },
    userHistory: { create: historyCreate },
  });
  Object.assign(transaction, {
    $transaction: async <T>(
      operation: (client: PrismaService) => Promise<T>,
    ) => {
      const before = current;
      const historyCount = histories.length;
      try {
        return await operation(transaction);
      } catch (error) {
        current = before;
        histories.splice(historyCount);
        throw error;
      }
    },
  });
  return {
    repository: new UsersRepository(
      transaction,
      new UserTransitionRepository(),
    ),
    findUnique,
    transactionFindUnique: findUnique,
    userUpdate,
    historyCreate,
    histories,
    recordPhoneAudit,
    recordStaffNumberAudit,
    transaction,
    current: () => current,
    replaceCurrent: (patch: Partial<Row> | null) => {
      if (patch === null) {
        current = null;
        return;
      }
      if (current === null) throw new Error('Missing user');
      current = { ...current, ...patch };
    },
    takeStudentId: (studentId: string) => {
      takenStudentId = studentId;
    },
  };
}
function toRow(record: UserProfileRecord): Row {
  const type = record.memberKind ?? 'UNSELECTED';
  return {
    id: record.id,
    githubId: record.githubId ?? 4242n,
    nickname: record.githubLogin ?? record.id,
    avatarUrl: null,
    phone: record.phone ?? null,
    staffNumber: record.staffNumber ?? null,
    name: record.name,
    studentId: record.studentId,
    department: record.department,
    departmentType: record.departmentType ?? null,
    type,
    profileCreatedAt: record.profileCreatedAt,
    profileUpdatedAt: record.profileCreatedAt,
    approvalStatus: record.approvalStatus,
    approvalRequestId: record.approvalRequestId,
    approvalRequestedAt:
      record.approvalRequestId === null ? null : new Date('2026-01-01'),
    approvalDecidedAt: null,
    approvalDecidedById: null,
    approvalReason: null,
    admin: record.hasAdminAccess ? { userId: record.id } : null,
    accountStatus: 'ACTIVE',
    sessionVersion: 0,
    notificationEmail: null,
    notifyEnabled: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}
