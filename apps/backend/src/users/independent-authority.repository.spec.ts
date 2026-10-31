import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  UsersAuthorityRepository,
  IndependentAuthorityRepository,
} from './independent-authority.repository';
import { resolveIndependentAuthorityTransition } from './independent-authority.service';

describe('authority.repository', () => {
  const actors = [
    {
      id: 'synthetic-staff',
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    },
    {
      id: 'synthetic-admin',
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
    {
      id: 'synthetic-role-less',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    },
    {
      id: 'synthetic-deactivated',
      hasStaffAccess: true,
      hasAdminAccess: true,
      accountStatus: AccountStatus.DEACTIVATED,
    },
    null,
  ];

  describe('UsersAuthorityRepository', () => {
    it.each(actors)(
      'returns the projection without filtering authority: %j',
      async (actor) => {
        const findUnique = jest.fn().mockResolvedValue(actor);
        const prisma = Object.assign(new PrismaService(), {
          user: { findUnique },
        });
        const repository = new UsersAuthorityRepository(prisma);

        await expect(
          repository.findActorByGithubId(9700200001n),
        ).resolves.toEqual(actor);
        expect(findUnique).toHaveBeenCalledTimes(1);
        expect(findUnique).toHaveBeenCalledWith({
          where: { githubId: 9700200001n },
          select: {
            id: true,
            hasStaffAccess: true,
            hasAdminAccess: true,
            accountStatus: true,
          },
        });
      },
    );

    it('uses the supplied session key on every lookup', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValueOnce(actors[1])
        .mockResolvedValueOnce(null);
      const prisma = Object.assign(new PrismaService(), {
        user: { findUnique },
      });
      const repository = new UsersAuthorityRepository(prisma);

      await expect(
        repository.findActorByGithubId(9700200001n),
      ).resolves.toEqual(actors[1]);
      await expect(
        repository.findActorByGithubId(9700200002n),
      ).resolves.toBeNull();
      expect(
        findUnique.mock.calls.map(
          ([input]: [{ where: { githubId: bigint } }]) => input.where.githubId,
        ),
      ).toEqual([9700200001n, 9700200002n]);
    });

    it('propagates database failures', async () => {
      const error = new Error('database-unavailable');
      const findUnique = jest.fn().mockRejectedValue(error);
      const prisma = Object.assign(new PrismaService(), {
        user: { findUnique },
      });
      const repository = new UsersAuthorityRepository(prisma);

      await expect(repository.findActorByGithubId(9700200001n)).rejects.toBe(
        error,
      );
    });
  });
});

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
  const repository = new IndependentAuthorityRepository(prisma);

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
  const repository = new IndependentAuthorityRepository(prisma);
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
