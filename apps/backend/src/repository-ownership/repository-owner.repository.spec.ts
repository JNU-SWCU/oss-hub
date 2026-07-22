import {
  RepositoryOwnerRepository,
  type RepositoryOwnerProjectionClient,
} from './repository-owner.repository';

describe('RepositoryOwnerRepository', () => {
  it('reads only the public-safe owner projection for requested repositories', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        githubRepositoryId: 9001n,
        ownerGithubId: 101n,
        ownerGithubLogin: 'renamed-owner',
      },
    ]);
    const prisma: RepositoryOwnerProjectionClient = {
      repositoryOwnerProjection: { findMany },
    };

    const result = await new RepositoryOwnerRepository(
      prisma,
    ).findByGithubRepositoryIds([9001n]);

    expect(result).toEqual([
      {
        githubRepositoryId: 9001n,
        ownerGithubId: 101n,
        ownerGithubLogin: 'renamed-owner',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { githubRepositoryId: { in: [9001n] } },
      select: {
        githubRepositoryId: true,
        ownerGithubId: true,
        ownerGithubLogin: true,
      },
    });
  });

  it('does not query for an empty repository id set', async () => {
    const findMany = jest.fn();
    const prisma: RepositoryOwnerProjectionClient = {
      repositoryOwnerProjection: { findMany },
    };
    const repository = new RepositoryOwnerRepository(prisma);

    await expect(repository.findByGithubRepositoryIds([])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
