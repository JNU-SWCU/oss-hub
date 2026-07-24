import { RANKING_PERIODS } from './domain/ranking';
import {
  batches,
  event,
  setupRankingService,
} from './ranking.service.spec-helper';

describe('RankingService public metrics', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('returns public ranking items with only ranking DTO fields', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'public-dto',
          '1',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          2,
        ),
      ]),
    );

    const result = await harness.service.findPage(RANKING_PERIODS.ALL, 1, 20);

    expect(result.items).toEqual([
      {
        rank: 1,
        displayName: 'mina',
        githubLogin: 'mina',
        commitCount: 2,
        prCount: 0,
        starCount: 0,
        total: 2,
      },
    ]);
    for (const internalField of [
      'applicationId',
      'applicantId',
      'answers',
      'teamId',
      'status',
    ]) {
      expect(result.items[0]).not.toHaveProperty(internalField);
    }
  });

  it('연결 저장소의 Push size, PR opened, Watch started만 한 번씩 집계한다', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'push-1',
          '1',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          5,
        ),
        event(
          'push-1',
          '1',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          99,
        ),
        event(
          'pr-1',
          '1',
          'mina',
          'PullRequestEvent',
          'opened',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'star-1',
          '2',
          'june',
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'pr-closed',
          '1',
          'mina',
          'PullRequestEvent',
          'closed',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'external',
          '1',
          'mina',
          'WatchEvent',
          'started',
          999,
          '2026-07-01T00:00:00.000Z',
        ),
      ]),
    );

    await expect(
      harness.service.findPage(
        RANKING_PERIODS.THIS_YEAR,
        1,
        20,
        new Date('2026-07-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      items: [
        {
          githubLogin: 'mina',
          commitCount: 5,
          prCount: 1,
          starCount: 0,
          total: 6,
        },
        {
          githubLogin: 'june',
          commitCount: 0,
          prCount: 0,
          starCount: 1,
          total: 1,
        },
      ],
      total: 2,
    });
  });
});
