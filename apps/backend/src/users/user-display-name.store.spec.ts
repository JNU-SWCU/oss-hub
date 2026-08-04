import {
  UserDisplayNameStore,
  type UserDisplayNameProjectionClient,
} from './user-display-name.store';

describe('UserDisplayNameStore', () => {
  it('resolves the compatible profile name for requested github ids', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { githubId: 1n, name: 'legacy-name', profile: null },
      { githubId: 2n, name: 'ignored', profile: { name: 'profile-name' } },
      { githubId: 3n, name: null, profile: null },
    ]);
    const prisma: UserDisplayNameProjectionClient = {
      user: { findMany },
    };

    const result = await new UserDisplayNameStore(prisma).findByGithubIds([
      1n,
      2n,
      3n,
    ]);

    expect(result).toEqual([
      { githubId: 1n, name: 'legacy-name' },
      { githubId: 2n, name: 'profile-name' },
      { githubId: 3n, name: null },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { githubId: { in: [1n, 2n, 3n] } },
      select: {
        githubId: true,
        name: true,
        profile: { select: { name: true } },
      },
    });
  });

  it('does not query for an empty github id set', async () => {
    const findMany = jest.fn();
    const prisma: UserDisplayNameProjectionClient = {
      user: { findMany },
    };
    const repository = new UserDisplayNameStore(prisma);

    await expect(repository.findByGithubIds([])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
