import { Logger } from '@nestjs/common';
import type {
  CollectionAppClient,
  CollectionContribution,
  CollectionContributionKind,
  CollectionProbeResult,
  CollectionProbeTarget,
  CollectionRepository,
  CollectionRepositoryContributions,
  CollectionRepositoryProbe,
} from './collection-app.client';
import type { CollectionAppTokenClient } from './collection-app-token.client';
import { CollectionAppClientError } from './collection-app.error';
import type {
  CollectionRepositoryRow,
  CollectionSyncRuntime,
  CollectionTarget,
  RecordContributionsResult,
  RepositorySource,
  SyncLeaseToken,
} from './collection-incremental.repository';
import {
  CollectionSyncService,
  type CollectionRunKind,
} from './collection-sync.service';
import type { ProviderRequestQueueClient } from './provider-request-queue.client';
import { RepositoryUrlService } from './repository-url.service';

type SyncRepository = ConstructorParameters<typeof CollectionSyncService>[0];

const STARTED_AT = new Date('2026-11-14T10:00:00.000Z');
const SUCCEEDED_AT = new Date('2026-11-14T09:55:00.000Z');
const HOURLY_SINCE = new Date('2026-10-31T10:00:00.000Z');
const LAST_SUCCESS_AT = new Date('2026-11-14T09:00:00.000Z');

const target = (
  githubRepositoryId: bigint,
  overrides: Partial<CollectionTarget> = {},
): CollectionTarget => ({
  id: `repo-${githubRepositoryId}`,
  githubOrganizationId: 1n,
  githubRepositoryId,
  nameWithOwner: `JNU-SWCU/repo-${githubRepositoryId}`,
  defaultBranch: 'main',
  archived: false,
  visibility: 'PRIVATE',
  presence: 'PRESENT',
  source: 'ORG_PROVISIONED',
  lastCompleteInventoryObservedAt: null,
  teamId: 'team-1',
  programId: 'program-1',
  lastSuccessAt: LAST_SUCCESS_AT,
  ...overrides,
});

const probeOf = (
  row: CollectionTarget,
  activityAt: readonly Date[],
  overrides: Partial<CollectionRepositoryProbe> = {},
): CollectionRepositoryProbe => ({
  githubRepositoryId: row.githubRepositoryId.toString(),
  nameWithOwner: row.nameWithOwner,
  defaultBranch: row.defaultBranch,
  archived: row.archived,
  private: row.visibility === 'PRIVATE',
  activityAt,
  ...overrides,
});

const contribution = (githubKey: string): CollectionContribution => ({
  githubKey,
  authorGithubId: '7',
  occurredAt: new Date('2026-11-14T08:00:00.000Z'),
});

const collected = (
  commit: readonly CollectionContribution[] = [],
): CollectionRepositoryContributions => ({
  contributions: { commit, pull_request: [], issue: [], release: [] },
  requests: 1,
  pointsUsed: 1,
  rateLimit: { cost: 1, remaining: 4000 },
});

const lease: SyncLeaseToken = {
  appId: 1n,
  scope: 'org:JNU-SWCU',
  ownerId: 'owner',
  epoch: 1n,
  runId: 'run-1',
  expiresAt: new Date('2026-11-14T10:10:00.000Z'),
};

function setup(targets: CollectionTarget[]) {
  const store = {
    assertSyncLeaseValid: jest.fn<Promise<void>, [SyncLeaseToken, Date]>(),
    recordContributions: jest.fn<
      Promise<RecordContributionsResult>,
      [string, CollectionContributionKind, readonly CollectionContribution[]]
    >((_, __, facts) =>
      Promise.resolve({ inserted: facts.length, authorFilled: 0 }),
    ),
    recordRepositorySuccess: jest.fn<
      Promise<void>,
      [readonly bigint[], Date]
    >(),
    refreshRepositoryObservation: jest.fn(
      (input: {
        source: RepositorySource;
        githubRepositoryId: bigint;
        nameWithOwner: string;
        defaultBranch: string | null;
        archived: boolean;
        visibility: 'PRIVATE' | 'PUBLIC';
        observedAt: Date;
      }): Promise<CollectionRepositoryRow | null> => {
        const row = targets.find(
          (item) => item.githubRepositoryId === input.githubRepositoryId,
        );
        return Promise.resolve(
          row === undefined
            ? null
            : {
                ...row,
                nameWithOwner: input.nameWithOwner,
                defaultBranch: input.defaultBranch,
                archived: input.archived,
                visibility: input.visibility,
              },
        );
      },
    ),
    markRepositoryGone: jest.fn<
      Promise<void>,
      [bigint, Date, RepositorySource]
    >(),
  };
  const repository = {
    ...store,
    runInTransaction: jest.fn(<T>(fn: (tx: typeof store) => Promise<T>) =>
      fn(store),
    ),
    listCollectionTargets: jest.fn((source: RepositorySource) =>
      Promise.resolve(targets.filter((item) => item.source === source)),
    ),
    findCollectionTargetByLogicalKey: jest.fn((id: bigint) =>
      Promise.resolve(
        targets.find((item) => item.githubRepositoryId === id) ?? null,
      ),
    ),
    acquireSyncLease: jest.fn<Promise<SyncLeaseToken | null>, [unknown]>(() =>
      Promise.resolve(lease),
    ),
    heartbeatSyncLease: jest.fn(() => Promise.resolve()),
    releaseSyncLease: jest.fn(() => Promise.resolve()),
  };
  const client = {
    probeRepositories: jest.fn(
      (
        probeTargets: readonly CollectionProbeTarget[],
      ): Promise<CollectionProbeResult> =>
        Promise.resolve({
          repositories: probeTargets.map((probeTarget) => {
            const row = targets.find(
              (item) =>
                item.nameWithOwner ===
                `${probeTarget.owner}/${probeTarget.name}`,
            );
            return row === undefined ? null : probeOf(row, []);
          }),
          rateLimit: { cost: 1, remaining: 4999 },
        }),
    ),
    getRepositoryById: jest.fn<Promise<CollectionRepository>, [bigint]>(),
    collectRepositoryContributions: jest.fn<
      Promise<CollectionRepositoryContributions>,
      [string, string, string | null, Date | null]
    >(() => Promise.resolve(collected([contribution('sha-1')]))),
  };
  const queue = { shouldStop: jest.fn(() => false) };
  const runtime: CollectionSyncRuntime = {
    appId: '1',
    organizationLogin: 'JNU-SWCU',
    tokens: {} as CollectionAppTokenClient,
    client: client as unknown as CollectionAppClient,
    queue: queue as unknown as ProviderRequestQueueClient,
  };
  const service = new CollectionSyncService(
    repository as unknown as SyncRepository,
    () => runtime,
    new RepositoryUrlService(),
    () => new Date(STARTED_AT),
    () => 'run-1',
    () => ({ ...runtime, organizationLogin: 'external' }),
  );
  return { service, store, repository, client, queue };
}

const summaryOf = (logger: jest.SpyInstance) =>
  (logger.mock.calls as [Record<string, unknown>][])
    .map(([entry]) => entry)
    .find((entry) => entry.event === 'collection.cycle.summary');

describe('CollectionSyncService probe/collect', () => {
  let logger: jest.SpyInstance;

  beforeEach(() => {
    logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    [
      '활동이 last_success_at 이후',
      [new Date('2026-11-14T09:00:00.001Z')],
      true,
    ],
    ['활동이 last_success_at과 같음', [LAST_SUCCESS_AT], false],
    ['활동이 없음', [], false],
  ])('%s이면 수집 여부가 %s', async (_label, activityAt, collect) => {
    const row = target(1n);
    const { service, client, store } = setup([row]);
    client.probeRepositories.mockResolvedValue({
      repositories: [probeOf(row, activityAt)],
      rateLimit: null,
    });

    await expect(service.run('owner')).resolves.toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: collect ? 1 : 0,
    });

    expect(client.collectRepositoryContributions).toHaveBeenCalledTimes(
      collect ? 1 : 0,
    );
    expect(store.recordRepositorySuccess).toHaveBeenCalledWith(
      [1n],
      SUCCEEDED_AT,
    );
  });

  it('last_success_at이 비어 있으면 활동이 없어도 수집한다', async () => {
    const row = target(1n, { lastSuccessAt: null });
    const { service, client } = setup([row]);

    await service.run('owner');

    expect(client.collectRepositoryContributions).toHaveBeenCalledWith(
      'JNU-SWCU',
      'repo-1',
      'main',
      HOURLY_SINCE,
    );
  });

  it('수집 성공은 네 종류 기여를 기록하고 같은 트랜잭션에서 last_success_at을 probe 시작 5분 전으로 올린다', async () => {
    const row = target(1n, { lastSuccessAt: null });
    const { service, store } = setup([row]);

    await expect(service.run('owner')).resolves.toMatchObject({
      insertedFactCount: 1,
    });

    expect(store.recordContributions.mock.calls.map((call) => call[1])).toEqual(
      ['commit', 'pull_request', 'issue', 'release'],
    );
    expect(store.recordContributions).toHaveBeenCalledWith('repo-1', 'commit', [
      contribution('sha-1'),
    ]);
    expect(store.recordRepositorySuccess).toHaveBeenCalledTimes(1);
    expect(store.recordRepositorySuccess).toHaveBeenCalledWith(
      [1n],
      SUCCEEDED_AT,
    );
  });

  it('저장소 100개마다 probe 요청을 하나씩 보낸다', async () => {
    const rows = Array.from({ length: 150 }, (_, index) =>
      target(BigInt(index + 1)),
    );
    const { service, client, store } = setup(rows);

    await service.run('owner');

    expect(
      client.probeRepositories.mock.calls.map(([batch]) => batch.length),
    ).toEqual([100, 50]);
    expect(client.collectRepositoryContributions).not.toHaveBeenCalled();
    expect(
      store.recordRepositorySuccess.mock.calls.flatMap(([ids]) => ids),
    ).toHaveLength(150);
    expect(summaryOf(logger)).toMatchObject({
      kind: 'hourly',
      repos: 150,
      probeRequests: 2,
      collectedRepos: 0,
      requests: 2,
      rateLimitRemaining: 4999,
    });
    expect(summaryOf(logger)).not.toHaveProperty('fullScanFailedRepos');
  });

  it('alias가 비면 id로 다시 찾아 바뀐 이름을 저장하고 수집한다', async () => {
    const row = target(1n);
    const { service, client, store } = setup([row]);
    client.probeRepositories.mockResolvedValue({
      repositories: [null],
      rateLimit: null,
    });
    client.getRepositoryById.mockResolvedValue({
      id: '1',
      fullName: 'JNU-SWCU/renamed',
      private: true,
      archived: false,
      defaultBranch: 'main',
    });

    await service.run('owner');

    expect(client.getRepositoryById).toHaveBeenCalledWith(1n);
    expect(store.refreshRepositoryObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepositoryId: 1n,
        nameWithOwner: 'JNU-SWCU/renamed',
      }),
    );
    expect(client.collectRepositoryContributions).toHaveBeenCalledWith(
      'JNU-SWCU',
      'renamed',
      'main',
      HOURLY_SINCE,
    );
  });

  it('alias 응답의 id가 다르면 이름이 다른 저장소로 넘어간 것으로 보고 id로 다시 찾는다', async () => {
    const row = target(1n);
    const { service, client } = setup([row]);
    client.probeRepositories.mockResolvedValue({
      repositories: [probeOf(row, [], { githubRepositoryId: '999' })],
      rateLimit: null,
    });
    client.getRepositoryById.mockRejectedValue(
      new CollectionAppClientError('NOT_FOUND'),
    );

    await service.run('owner');

    expect(client.getRepositoryById).toHaveBeenCalledWith(1n);
    expect(client.collectRepositoryContributions).not.toHaveBeenCalled();
  });

  it.each(['NOT_FOUND', 'PERMISSION'] as const)(
    'id 조회가 %s이면 저장소를 gone으로 표시하고 last_success_at은 건드리지 않는다',
    async (kind) => {
      const row = target(1n);
      const { service, client, store } = setup([row]);
      client.probeRepositories.mockResolvedValue({
        repositories: [null],
        rateLimit: null,
      });
      client.getRepositoryById.mockRejectedValue(
        new CollectionAppClientError(kind),
      );

      await expect(service.run('owner')).resolves.toMatchObject({
        status: 'COMPLETED',
      });

      expect(store.markRepositoryGone).toHaveBeenCalledWith(
        1n,
        STARTED_AT,
        'ORG_PROVISIONED',
      );
      expect(store.recordRepositorySuccess).not.toHaveBeenCalled();
    },
  );

  it('probe가 RATE_LIMITED면 실행 전체가 실패하고 아무 저장소도 성공으로 기록하지 않는다', async () => {
    const { service, client, store, repository } = setup([target(1n)]);
    client.probeRepositories.mockRejectedValue(
      new CollectionAppClientError('RATE_LIMITED'),
    );

    await expect(service.run('owner')).resolves.toMatchObject({
      status: 'FAILED',
    });

    expect(store.recordRepositorySuccess).not.toHaveBeenCalled();
    expect(repository.releaseSyncLease).toHaveBeenCalled();
    expect(summaryOf(logger)).toMatchObject({ status: 'FAILED' });
  });

  it('수집 중 RATE_LIMITED도 실행 전체를 실패시킨다', async () => {
    const { service, client, store } = setup([
      target(1n, { lastSuccessAt: null }),
    ]);
    client.collectRepositoryContributions.mockRejectedValue(
      new CollectionAppClientError('RATE_LIMITED'),
    );

    await expect(service.run('owner')).resolves.toMatchObject({
      status: 'FAILED',
    });
    expect(store.recordRepositorySuccess).not.toHaveBeenCalled();
  });

  type Path = 'run' | 'runExternal' | 'runRepository';
  const invoke = (service: CollectionSyncService, path: Path) =>
    path === 'runRepository'
      ? service.runRepository('owner', 1n)
      : service[path]('owner', 'run-1', 'full');

  it.each<[Path, 'PAGINATION' | 'DEADLINE']>([
    ['run', 'PAGINATION'],
    ['run', 'DEADLINE'],
    ['runExternal', 'PAGINATION'],
    ['runExternal', 'DEADLINE'],
    ['runRepository', 'PAGINATION'],
    ['runRepository', 'DEADLINE'],
  ])(
    '%s에서 %s로 잘리면 그 저장소의 last_success_at과 기여를 쓰지 않고 다른 저장소는 계속한다',
    async (path, kind) => {
      const source: RepositorySource =
        path === 'runExternal' ? 'EXTERNAL_PUBLIC' : 'ORG_PROVISIONED';
      const visibility = source === 'EXTERNAL_PUBLIC' ? 'PUBLIC' : 'PRIVATE';
      const rows = [
        target(1n, { source, visibility }),
        target(2n, { source, visibility }),
      ];
      const { service, client, store } = setup(rows);
      client.collectRepositoryContributions.mockImplementation((_, name) =>
        name === 'repo-1'
          ? Promise.reject(new CollectionAppClientError(kind))
          : Promise.resolve(collected()),
      );

      await expect(invoke(service, path)).resolves.toMatchObject({
        status: 'COMPLETED',
      });

      const succeeded = store.recordRepositorySuccess.mock.calls.flatMap(
        ([ids]) => ids,
      );
      expect(succeeded).not.toContain(1n);
      expect(
        store.recordContributions.mock.calls.map(
          ([repositoryId]) => repositoryId,
        ),
      ).not.toContain('repo-1');
      if (path !== 'runRepository') {
        expect(succeeded).toEqual([2n]);
        expect(summaryOf(logger)).toMatchObject({
          kind: 'full',
          fullScanFailedRepos: 1,
          truncatedRepos: 1,
        });
      }
    },
  );

  it.each<[CollectionRunKind, Date | null]>([
    ['weekly', null],
    ['full', null],
  ])(
    '%s 실행은 활동이 없어도 모든 저장소를 since=%s로 다시 수집한다',
    async (kind, since) => {
      const rows = [target(1n), target(2n)];
      const { service, client } = setup(rows);

      await service.run('owner', 'run-1', kind);

      expect(client.collectRepositoryContributions.mock.calls).toEqual([
        ['JNU-SWCU', 'repo-1', 'main', since],
        ['JNU-SWCU', 'repo-2', 'main', since],
      ]);
      expect(summaryOf(logger)).toMatchObject({
        kind,
        collectedRepos: 2,
        fullScanFailedRepos: 0,
        truncatedRepos: 0,
      });
    },
  );

  it('lease를 다른 실행이 쥐고 있으면 provider를 부르지 않는다', async () => {
    const { service, client, repository } = setup([target(1n)]);
    repository.acquireSyncLease.mockResolvedValue(null);

    await expect(service.run('owner')).resolves.toMatchObject({
      status: 'SKIPPED_LEASE_HELD',
    });
    expect(client.probeRepositories).not.toHaveBeenCalled();
  });

  it('요청 예산이 바닥이면 probe 전에 멈추고 성공을 기록하지 않는다', async () => {
    const { service, client, queue, store } = setup([target(1n)]);
    queue.shouldStop.mockReturnValue(true);

    await expect(service.run('owner')).resolves.toMatchObject({
      status: 'COMPLETED',
      stoppedForBudget: true,
    });
    expect(client.probeRepositories).not.toHaveBeenCalled();
    expect(store.recordRepositorySuccess).not.toHaveBeenCalled();
  });

  it('runRepository는 연결된 저장소 1건을 probe 없이 최근 14일로 수집한다', async () => {
    const { service, client, store } = setup([target(1n)]);

    await expect(service.runRepository('owner', 1n)).resolves.toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: 1,
    });

    expect(client.probeRepositories).not.toHaveBeenCalled();
    expect(client.collectRepositoryContributions).toHaveBeenCalledWith(
      'JNU-SWCU',
      'repo-1',
      'main',
      HOURLY_SINCE,
    );
    expect(store.recordRepositorySuccess).toHaveBeenCalledWith(
      [1n],
      SUCCEEDED_AT,
    );
  });

  it.each([
    ['팀 연결이 없는 저장소', { teamId: null }],
    ['사라진 저장소', { presence: 'ABSENT' as const }],
    [
      '비공개로 바뀐 외부 저장소',
      { source: 'EXTERNAL_PUBLIC' as const, visibility: 'PRIVATE' as const },
    ],
  ])('runRepository는 %s를 수집하지 않는다', async (_label, overrides) => {
    const { service, client } = setup([target(1n, overrides)]);

    await expect(service.runRepository('owner', 1n)).resolves.toMatchObject({
      status: 'SKIPPED',
    });
    expect(client.collectRepositoryContributions).not.toHaveBeenCalled();
  });
});
