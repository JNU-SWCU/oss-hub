import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { resolveIndependentAuthorityTransition } from './independent-authority-transition';

it('locks the target and dual-writes the deterministic rollback projection', async () => {
  // Given
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
  const repository = new IndependentAuthorityRepository(prisma);

  // When
  await repository.withTransaction(async (store) => {
    expect(store.auditLogWriter).toBe(transaction);
    const before = await store.findUserForUpdate('target');
    if (!before) {
      throw new TypeError('Expected target');
    }
    const transition = resolveIndependentAuthorityTransition(
      before,
      'ADMIN',
      false,
    );
    await store.updateAuthority('target', transition);
  });

  // Then
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
  // Given
  const create = jest.fn().mockResolvedValue({ id: 'revoked-request' });
  const transaction = { staffAccessRequest: { create } };
  const prisma = Object.assign(new PrismaService(), {
    $transaction: <T>(
      operation: (store: typeof transaction) => Promise<T>,
    ): Promise<T> => operation(transaction),
  });
  const repository = new IndependentAuthorityRepository(prisma);
  const decidedAt = new Date('2026-09-23T00:00:00.000Z');

  // When
  const inserted = await repository.withTransaction((store) =>
    store.insertRevokedRequest({
      userId: 'target',
      actorId: 'actor',
      decidedAt,
    }),
  );

  // Then
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
