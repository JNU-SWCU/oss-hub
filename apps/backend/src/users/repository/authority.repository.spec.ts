import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersAuthorityRepository } from './authority.repository';

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
    const prisma = Object.assign(new PrismaService(), { user: { findUnique } });
    const repository = new UsersAuthorityRepository(prisma);

    await expect(repository.findActorByGithubId(9700200001n)).resolves.toEqual(
      actors[1],
    );
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
    const prisma = Object.assign(new PrismaService(), { user: { findUnique } });
    const repository = new UsersAuthorityRepository(prisma);

    await expect(repository.findActorByGithubId(9700200001n)).rejects.toBe(
      error,
    );
  });
});
