import { PlatformRepository } from '../platform/platform.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';

const independentAuthorityService = new IndependentAuthorityService(
  undefined as never,
  undefined as never,
  new AuditLogMetadataService(),
  new AdminAccessMutationService(
    new AuditLogMetadataService(),
    new UserProfileService(),
  ),
  new UserProfileService(),
);

it('locks the target and dual-writes the deterministic rollback projection', async () => {
  const update = jest.fn().mockResolvedValue({});
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'target' }]),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'target',
        githubId: 9_700_200_001n,
        nickname: 'synthetic-target',
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: AccountStatus.ACTIVE,
        profile: {
          name: '합성 교직원',
          studentId: null,
          department: '합성 사업단',
          memberKind: MemberKind.STAFF,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
          affiliationName: '합성 사업단',
        },
        staffAccessRequests: [],
        loginHistories: [],
      }),
      update,
    },
  };
  const prisma = Object.assign(new PrismaService(), {
    $transaction: <T>(
      operation: (store: typeof transaction) => Promise<T>,
    ): Promise<T> => operation(transaction),
  });
  const repository = new IndependentAuthorityRepository(
    prisma,
    new AdminAccessReadRepository(
      new AdminAccessReadOrderingRepository(),
      new PlatformRepository(),
    ),
    new AdminAccessRepository(
      prisma,
      new AdminAccessHistoryRepository(),
      new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
        new PlatformRepository(),
      ),
    ),
  );

  await repository.withTransaction(async (store) => {
    expect(store.auditLogWriter).toBe(transaction);
    const before = await store.findUserForUpdate('target');
    if (!before) {
      throw new TypeError('Expected target');
    }
    const transition =
      independentAuthorityService.resolveIndependentAuthorityTransition(
        before,
        'ADMIN',
        false,
      );
    await store.updateAuthority('target', transition);
  });

  expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith({
    where: { id: 'target' },
    data: {
      selectedMemberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
  });
});

it('교직원 회수 이력을 옛 CAS 경로와 같은 모양으로 같은 트랜잭션에 넣는다', async () => {
  const create = jest.fn().mockResolvedValue({ id: 'revoked-request' });
  const transaction = { staffAccessRequest: { create } };
  const prisma = Object.assign(new PrismaService(), {
    $transaction: <T>(
      operation: (store: typeof transaction) => Promise<T>,
    ): Promise<T> => operation(transaction),
  });
  const repository = new IndependentAuthorityRepository(
    prisma,
    new AdminAccessReadRepository(
      new AdminAccessReadOrderingRepository(),
      new PlatformRepository(),
    ),
    new AdminAccessRepository(
      prisma,
      new AdminAccessHistoryRepository(),
      new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
        new PlatformRepository(),
      ),
    ),
  );
  const decidedAt = new Date('2026-09-23T00:00:00.000Z');

  const inserted = await repository.withTransaction((store) =>
    store.insertRevokedRequest({
      userId: 'target',
      actorId: 'actor',
      decidedAt,
    }),
  );

  expect(inserted).toEqual({ id: 'revoked-request' });
  expect(create).toHaveBeenCalledWith({
    data: {
      userId: 'target',
      status: StaffAccessRequestStatus.REVOKED,
      decidedById: 'actor',
      decidedAt,
    },
    select: { id: true },
  });
});
