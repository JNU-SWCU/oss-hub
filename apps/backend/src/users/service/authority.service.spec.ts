import { AccountStatus } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { UsersAuthorityService } from './authority.service';

const policyCases = [
  {
    label: 'staff',
    hasStaffAccess: true,
    hasAdminAccess: false,
    staff: true,
    admin: false,
  },
  {
    label: 'admin without staff access',
    hasStaffAccess: false,
    hasAdminAccess: true,
    staff: true,
    admin: true,
  },
  {
    label: 'staff and admin',
    hasStaffAccess: true,
    hasAdminAccess: true,
    staff: true,
    admin: true,
  },
  {
    label: 'role-less',
    hasStaffAccess: false,
    hasAdminAccess: false,
    staff: false,
    admin: false,
  },
];

for (const method of ['assertActiveStaff', 'assertAdmin'] as const) {
  describe(method, () => {
    it.each(policyCases)('applies the active $label policy', async (policy) => {
      const actor = {
        id: 'synthetic-actor',
        hasStaffAccess: policy.hasStaffAccess,
        hasAdminAccess: policy.hasAdminAccess,
        accountStatus: AccountStatus.ACTIVE,
      };
      const findActorByGithubId = jest.fn().mockResolvedValue(actor);
      const service = new UsersAuthorityService({ findActorByGithubId });
      const error = new DomainException({
        code: 'SYNTHETIC_FORBIDDEN',
        status: 403,
        message: 'caller-owned-forbidden',
      });
      const forbidden = jest.fn(() => error);
      const operation = service[method](9700200001n, forbidden);
      const allowed =
        method === 'assertActiveStaff' ? policy.staff : policy.admin;

      if (allowed) {
        await expect(operation).resolves.toEqual({ actorId: actor.id });
        expect(forbidden).not.toHaveBeenCalled();
      } else {
        await expect(operation).rejects.toBe(error);
        expect(forbidden).toHaveBeenCalledTimes(1);
      }
      expect(findActorByGithubId).toHaveBeenCalledTimes(1);
      expect(findActorByGithubId).toHaveBeenCalledWith(9700200001n);
    });

    it.each(policyCases)(
      'rejects deactivated $label regardless of access',
      async (policy) => {
        const findActorByGithubId = jest.fn().mockResolvedValue({
          id: 'synthetic-deactivated',
          hasStaffAccess: policy.hasStaffAccess,
          hasAdminAccess: policy.hasAdminAccess,
          accountStatus: AccountStatus.DEACTIVATED,
        });
        const service = new UsersAuthorityService({ findActorByGithubId });
        const error = new Error('caller-owned-inactive');
        const forbidden = jest.fn(() => error);

        await expect(service[method](9700200001n, forbidden)).rejects.toBe(
          error,
        );
        expect(forbidden).toHaveBeenCalledTimes(1);
        expect(findActorByGithubId).toHaveBeenCalledTimes(1);
      },
    );

    it.each([9700200001n, 9700200002n])(
      'rejects a missing user for session %s',
      async (githubId) => {
        const findActorByGithubId = jest.fn().mockResolvedValue(null);
        const service = new UsersAuthorityService({ findActorByGithubId });
        const error = new Error('caller-owned-missing');
        const forbidden = jest.fn(() => error);

        await expect(service[method](githubId, forbidden)).rejects.toBe(error);
        expect(findActorByGithubId).toHaveBeenCalledWith(githubId);
        expect(forbidden).toHaveBeenCalledTimes(1);
      },
    );

    it('does not reuse authority from a different session', async () => {
      const findActorByGithubId = jest.fn((githubId: bigint) =>
        Promise.resolve(
          githubId === 9700200001n
            ? {
                id: 'synthetic-admin',
                hasStaffAccess: true,
                hasAdminAccess: true,
                accountStatus: AccountStatus.ACTIVE,
              }
            : null,
        ),
      );
      const service = new UsersAuthorityService({ findActorByGithubId });
      const error = new Error('wrong-session');
      const forbidden = jest.fn(() => error);

      await expect(service[method](9700200001n, forbidden)).resolves.toEqual({
        actorId: 'synthetic-admin',
      });
      await expect(service[method](9700200002n, forbidden)).rejects.toBe(error);
      expect(findActorByGithubId.mock.calls).toEqual([
        [9700200001n],
        [9700200002n],
      ]);
      expect(forbidden).toHaveBeenCalledTimes(1);
    });

    it('propagates lookup failure without converting it to forbidden', async () => {
      const error = new Error('database-unavailable');
      const findActorByGithubId = jest.fn().mockRejectedValue(error);
      const service = new UsersAuthorityService({ findActorByGithubId });
      const forbidden = jest.fn(() => new Error('forbidden'));

      await expect(service[method](9700200001n, forbidden)).rejects.toBe(error);
      expect(forbidden).not.toHaveBeenCalled();
    });
  });
}
