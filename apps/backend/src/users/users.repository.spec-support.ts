import type { AuditLogRecord } from '../audit-log/audit-log.repository';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';
import type { UserProfileRecord } from './user-profile-policy';
import { profileRecord } from './member-authority-test-fixtures';

type TransactionCallback<T> = (transaction: unknown) => Promise<T>;

const auditLogRecord = {
  id: 'synthetic-audit-record',
  actor: 'synthetic-user',
  actorHandle: null,
  action: 'SYNTHETIC',
  targetType: 'USER',
  targetId: 'synthetic-user',
  target: 'synthetic-user',
  targetHandle: null,
  occurredAt: new Date(0),
  legacy: true,
  metadata: null,
} satisfies AuditLogRecord;

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
  const auditRecord = jest
    .fn<
      ReturnType<AuditLogService['record']>,
      Parameters<AuditLogService['record']>
    >()
    .mockResolvedValue(auditLogRecord);
  // `$queryRaw`는 잠금 후 현재 전화번호를 읽는 경로이다. 기본값은 `current`와 같은
  // 행이고, 동시 갱신 상황은 테스트에서 이 mock을 다른 값으로 바꿔 재현한다.
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ phone: current.phone ?? null }]),
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
    auditLog: { create: jest.fn() },
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
    auditRecord,
    transaction,
    repository: new UsersRepository(prisma, { record: auditRecord }),
  };
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
