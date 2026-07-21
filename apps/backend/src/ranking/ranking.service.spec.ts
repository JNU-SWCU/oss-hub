import { RANKING_NOTICE, RANKING_PERIODS } from './domain/ranking';
import {
  RankingRepository,
  type RankingObservation,
} from './ranking.repository';
import { RankingService } from './ranking.service';

function event(
  id: string,
  targetGithubId: string,
  targetLogin: string,
  type: string,
  action: string | null,
  repositoryId: number,
  createdAt: string,
  size?: number,
  runStartedAt = '2026-07-01T00:00:00.000Z',
): RankingObservation {
  return {
    id: `observation-${id}-${targetGithubId}-${runStartedAt}`,
    sourceId: id,
    targetGithubId,
    targetLogin,
    runId: `run-${targetGithubId}-${runStartedAt}`,
    runStartedAt: new Date(runStartedAt),
    payload: {
      type,
      created_at: createdAt,
      repo: { id: repositoryId },
      payload: {
        ...(action ? { action } : {}),
        ...(size === undefined ? {} : { size }),
        commits: [{ sha: 'must-not-be-counted' }, { sha: 'also-ignored' }],
      },
    },
  };
}

async function* batches(
  observations: readonly RankingObservation[],
): AsyncGenerator<readonly RankingObservation[]> {
  await Promise.resolve();
  yield observations;
}

async function* repositoryBatches(
  repositoryIds: readonly string[],
): AsyncGenerator<readonly string[]> {
  await Promise.resolve();
  yield repositoryIds;
}

describe('RankingService', () => {
  const findPlatformRepositoryIdBatches = jest.fn();
  const findObservationBatches = jest.fn();
  const repository = {
    findPlatformRepositoryIdBatches,
    findObservationBatches,
  } as unknown as RankingRepository;
  let service: RankingService;

  beforeEach(() => {
    findPlatformRepositoryIdBatches
      .mockReset()
      .mockImplementation(() => repositoryBatches(['101']));
    findObservationBatches.mockReset();
    service = new RankingService(repository);
  });

  it('연결 저장소의 Push size, PR opened, Watch started만 한 번씩 집계한다', async () => {
    findObservationBatches.mockReturnValue(
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
      service.findPage(
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

  it('githubId가 같으면 로그인 변경 전후 활동을 최신 login 한 entry로 합친다', async () => {
    findObservationBatches.mockReturnValue(
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
      service.findPage(RANKING_PERIODS.ALL, 1, 20),
    ).resolves.toMatchObject({
      items: [
        { githubLogin: 'new-login', commitCount: 2, prCount: 1, total: 3 },
      ],
      total: 1,
    });
  });

  it('login이 같아도 githubId가 다르면 별도 entry로 유지한다', async () => {
    findObservationBatches.mockReturnValue(
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
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
      ]),
    );

    const result = await service.findPage(RANKING_PERIODS.ALL, 1, 20);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.githubLogin)).toEqual([
      'shared',
      'shared',
    ]);
    expect(result.items.map((item) => item.total)).toEqual([2, 1]);
  });

  it('동시·반복 요청은 같은 집계를 공유하고 올해 시작 시각을 저장소에 전달한다', async () => {
    findObservationBatches.mockImplementation(() =>
      batches([
        event(
          'one',
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
    const now = new Date('2026-07-21T00:00:00.000Z');

    await Promise.all([
      service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now),
      service.findPage(RANKING_PERIODS.THIS_YEAR, 2, 1, now),
    ]);
    await service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now);

    expect(findPlatformRepositoryIdBatches).toHaveBeenCalledTimes(1);
    expect(findObservationBatches).toHaveBeenCalledTimes(1);
    expect(findObservationBatches).toHaveBeenCalledWith(
      new Date('2026-01-01T00:00:00.000Z'),
    );
  });

  it('올해와 전체는 별도 cache key를 사용하고 기간을 event 시각으로 판정한다', async () => {
    const observations = [
      event(
        'this-year',
        '1',
        'mina',
        'PushEvent',
        null,
        101,
        '2026-01-01T00:00:00.000Z',
        2,
      ),
      event(
        'last-year',
        '2',
        'june',
        'WatchEvent',
        'started',
        101,
        '2025-12-31T23:59:59.000Z',
      ),
    ];
    findObservationBatches.mockImplementation(() => batches(observations));
    const now = new Date('2026-07-21T00:00:00.000Z');

    await expect(
      service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now),
    ).resolves.toMatchObject({ total: 1 });
    const all = await service.findPage(RANKING_PERIODS.ALL, 1, 20, now);
    expect(all).toMatchObject({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.ALL,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(all.items).toHaveLength(2);
    expect(findObservationBatches).toHaveBeenCalledTimes(2);
    expect(findObservationBatches).toHaveBeenLastCalledWith(undefined);
  });
});
