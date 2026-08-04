import { RankingUserEligibilityRepository } from './ranking-user-eligibility.repository';

describe('RankingUserEligibilityRepository', () => {
  it('returns only projected GitHub ids in one batch query', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ githubUserId: 2n }]);
    const repository = new RankingUserEligibilityRepository({
      $queryRaw: queryRaw,
    });

    await expect(
      repository.findEligibleGithubIds([1n, 2n, 2n]),
    ).resolves.toEqual(new Set([2n]));
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails closed without querying when no contributor ids exist', async () => {
    const queryRaw = jest.fn();
    const repository = new RankingUserEligibilityRepository({
      $queryRaw: queryRaw,
    });

    await expect(repository.findEligibleGithubIds([])).resolves.toEqual(
      new Set(),
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
