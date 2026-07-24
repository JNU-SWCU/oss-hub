import { RANKING_PERIODS } from './domain/ranking';
import {
  batches,
  event,
  setupRankingService,
} from './ranking.service.spec-helper';

describe('RankingService identity and privacy', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('githubId가 같으면 로그인 변경 전후 활동을 최신 login 한 entry로 합친다', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'old',
          '77',
          'old-login',
          'PushEvent',
          null,
          101,
          '2026-06-01T00:00:00.000Z',
          2,
          '2026-06-02T00:00:00.000Z',
        ),
        event(
          'new',
          '77',
          'new-login',
          'PullRequestEvent',
          'opened',
          101,
          '2026-07-01T00:00:00.000Z',
          undefined,
          '2026-07-02T00:00:00.000Z',
        ),
      ]),
    );

    await expect(
      harness.service.findPage(RANKING_PERIODS.ALL, 1, 20),
    ).resolves.toMatchObject({
      items: [
        { githubLogin: 'new-login', commitCount: 2, prCount: 1, total: 3 },
      ],
      total: 1,
    });
  });

  it('제외된 저장소 event의 login을 공개 랭킹 identity에 사용하지 않는다', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'included',
          '77',
          'old-login',
          'PushEvent',
          null,
          101,
          '2026-06-01T00:00:00.000Z',
          2,
          '2026-06-02T00:00:00.000Z',
        ),
        event(
          'excluded',
          '77',
          'new-login',
          'PushEvent',
          null,
          999,
          '2026-07-01T00:00:00.000Z',
          3,
          '2026-07-02T00:00:00.000Z',
        ),
      ]),
    );

    await expect(
      harness.service.findPage(RANKING_PERIODS.ALL, 1, 20),
    ).resolves.toMatchObject({
      items: [
        { githubLogin: 'old-login', commitCount: 2, prCount: 0, total: 2 },
      ],
      total: 1,
    });
  });

  it('login이 같아도 githubId가 다르면 별도 entry로 유지한다', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'one',
          '1',
          'shared',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          2,
        ),
        event(
          'two',
          '2',
          'shared',
          'PullRequestEvent',
          'opened',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
      ]),
    );

    const result = await harness.service.findPage(RANKING_PERIODS.ALL, 1, 20);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.githubLogin)).toEqual([
      'shared',
      'shared',
    ]);
    expect(result.items.map((item) => item.total)).toEqual([2, 1]);
  });
});
