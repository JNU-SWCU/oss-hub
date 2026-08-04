import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService display name', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('shows the resolved profile name when one exists', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'octo-cat', 2, 0, 0),
    ]);
    harness.findByGithubIds.mockResolvedValue([
      { githubId: 1n, name: 'Octo Cat' },
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'Octo Cat',
        githubLogin: 'octo-cat',
      }),
    ]);
    expect(harness.findByGithubIds).toHaveBeenCalledWith([1n]);
  });

  it('falls back to the GitHub login when the name is null', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(2n, 'nameless', 1, 0, 0),
    ]);
    harness.findByGithubIds.mockResolvedValue([{ githubId: 2n, name: null }]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'nameless',
        githubLogin: 'nameless',
      }),
    ]);
  });

  it('falls back to the GitHub login when the name is empty or whitespace only', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(3n, 'blank-name', 1, 0, 0),
      activity(4n, 'whitespace-name', 1, 0, 0),
    ]);
    harness.findByGithubIds.mockResolvedValue([
      { githubId: 3n, name: '' },
      { githubId: 4n, name: '   ' },
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(
      result.items.map(({ displayName, githubLogin }) => ({
        displayName,
        githubLogin,
      })),
    ).toEqual(
      expect.arrayContaining([
        { displayName: 'blank-name', githubLogin: 'blank-name' },
        { displayName: 'whitespace-name', githubLogin: 'whitespace-name' },
      ]),
    );
  });

  it('falls back to the GitHub login when the user row is missing entirely', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(5n, 'ghost-user', 1, 0, 0),
    ]);
    harness.findByGithubIds.mockResolvedValue([]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'ghost-user',
        githubLogin: 'ghost-user',
      }),
    ]);
  });

  it('trims surrounding whitespace on an otherwise valid name', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(6n, 'padded-name', 1, 0, 0),
    ]);
    harness.findByGithubIds.mockResolvedValue([
      { githubId: 6n, name: '  Padded Name  ' },
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'Padded Name',
        githubLogin: 'padded-name',
      }),
    ]);
  });

  it('does not query display names for an empty ranking', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([]);

    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(harness.findByGithubIds).toHaveBeenCalledWith([]);
  });
});
