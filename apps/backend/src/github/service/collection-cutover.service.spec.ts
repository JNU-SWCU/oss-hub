import { CollectionCutoverService } from './collection-cutover.service';
import type { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import type {
  CanonicalGenerationSnapshot,
  CanonicalLeaseKey,
} from '../collection-canonical.types';
import type { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import type { CutoverLeaseToken } from '../collection-cutover.types';
import type {
  CollectionGenerationImportService,
  GenerationImportResult,
} from './collection-generation-import.service';
import type {
  CollectionSyncRunResult,
  CollectionSyncService,
} from './collection-sync.service';

/**
 * todo 14 원자 전환 orchestration의 abort 경로/성공 경로 매핑. 각 협력자는 이 서비스가
 * 요구하는 최소 메서드만 (Pick으로) 노출하므로 jest.fn() 수준의 얕은 mock으로 충분하다 —
 * 트랜잭션 원자성 자체는 `CollectionIncrementalRepository`/`CollectionGenerationImportService`
 * 자신의 spec에서 이미 다룬다.
 */

const KEY: CanonicalLeaseKey = { appId: 1n, organizationLogin: 'jnu-swcu' };

const LEASE_TOKEN: CutoverLeaseToken = {
  appId: 1n,
  scope: 'org:jnu-swcu',
  ownerId: 'cli:owner-1',
  epoch: 1n,
  runId: 'cutover-run-1',
  expiresAt: new Date('2026-08-01T04:00:00.000Z'),
};

const snapshot = (
  overrides: Partial<CanonicalGenerationSnapshot> = {},
): CanonicalGenerationSnapshot => ({
  runId: 'generation-1',
  finishedAt: new Date('2026-07-31T00:00:00.000Z'),
  repositories: [
    {
      githubRepositoryId: 101n,
      fullName: 'org/repo',
      visibility: 'public',
      archived: false,
      defaultBranch: 'main',
    },
  ],
  commits: [
    {
      githubRepositoryId: 101n,
      sha: 'a'.repeat(40),
      committedAt: new Date('2026-07-30T00:00:00.000Z'),
      authorGithubId: 1n,
      authorGithubLogin: 'synthetic-registered',
    },
  ],
  pullRequests: [],
  releases: [],
  ...overrides,
});

const importResult = (
  overrides: Partial<GenerationImportResult> = {},
): GenerationImportResult => ({
  imported: true,
  generationId: 'generation-1',
  repositoryCount: 1,
  repositories: [
    {
      githubRepositoryId: '101',
      repositoryId: 'repo-1',
      commitsAccepted: 1,
      commitsInserted: 1,
      pullRequestsAccepted: 0,
      pullRequestsInserted: 0,
      releasesAccepted: 0,
      releasesInserted: 0,
    },
  ],
  digest: 'digest-1',
  ...overrides,
});

const syncResult = (
  overrides: Partial<CollectionSyncRunResult> = {},
): CollectionSyncRunResult => ({
  runId: 'sync-run-1',
  status: 'COMPLETED',
  inventoryComplete: true,
  processedRepositoryCount: 1,
  cycleCompleted: true,
  stoppedForBudget: false,
  insertedFactCount: 0,
  ...overrides,
});

interface Collaborators {
  canonicalRepository: Pick<
    CollectionCanonicalRepository,
    'getActiveGenerationSnapshot'
  > & { getActiveGenerationSnapshot: jest.Mock };
  generationImportService: Pick<
    CollectionGenerationImportService,
    'importActiveGeneration'
  > & { importActiveGeneration: jest.Mock };
  syncService: Pick<CollectionSyncService, 'run'> & { run: jest.Mock };
  cutoverRepository: jest.Mocked<
    Pick<
      CollectionCutoverRepository,
      | 'acquireLease'
      | 'releaseLease'
      | 'countVerifyingStreams'
      | 'countCommitFactsForRepositories'
      | 'countPullRequestFactsForRepositories'
      | 'countReleaseFactsForRepositories'
    >
  >;
}

const createCollaborators = (): Collaborators => ({
  canonicalRepository: {
    getActiveGenerationSnapshot: jest.fn().mockResolvedValue(snapshot()),
  },
  generationImportService: {
    importActiveGeneration: jest.fn().mockResolvedValue(importResult()),
  },
  syncService: { run: jest.fn().mockResolvedValue(syncResult()) },
  cutoverRepository: {
    acquireLease: jest.fn().mockResolvedValue(LEASE_TOKEN),
    releaseLease: jest.fn().mockResolvedValue(undefined),
    countVerifyingStreams: jest.fn().mockResolvedValue(0),
    countCommitFactsForRepositories: jest.fn().mockResolvedValue(1),
    countPullRequestFactsForRepositories: jest.fn().mockResolvedValue(0),
    countReleaseFactsForRepositories: jest.fn().mockResolvedValue(0),
  },
});

const serviceFor = (collaborators: Collaborators): CollectionCutoverService =>
  new CollectionCutoverService(
    collaborators.canonicalRepository,
    collaborators.generationImportService,
    collaborators.syncService,
    collaborators.cutoverRepository as unknown as CollectionCutoverRepository,
    () => Promise.resolve(KEY),
    () => new Date('2026-08-01T00:00:00.000Z'),
    () => 'cutover-run-1',
  );

describe('CollectionCutoverService — runCutover', () => {
  it('ALREADY_IN_PROGRESS: lease를 획득하지 못하면 즉시 중단하고 어떤 협력자도 부르지 않는다', async () => {
    const collaborators = createCollaborators();
    collaborators.cutoverRepository.acquireLease.mockResolvedValue(null);

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'ALREADY_IN_PROGRESS',
      generationId: null,
    });
    expect(
      collaborators.canonicalRepository.getActiveGenerationSnapshot,
    ).not.toHaveBeenCalled();
    expect(collaborators.cutoverRepository.releaseLease).not.toHaveBeenCalled();
  });

  it('NO_GENERATION: 성공한 generation이 없으면 발명하지 않고 중단한다', async () => {
    const collaborators = createCollaborators();
    collaborators.canonicalRepository.getActiveGenerationSnapshot.mockResolvedValue(
      null,
    );

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'NO_GENERATION',
      generationId: null,
    });
    expect(collaborators.cutoverRepository.releaseLease).toHaveBeenCalledWith(
      LEASE_TOKEN,
      expect.any(Date),
    );
  });

  it('POINTER_CHANGED: re-import한 generationId가 pin한 포인터와 다르면 중단한다', async () => {
    const collaborators = createCollaborators();
    collaborators.generationImportService.importActiveGeneration.mockResolvedValue(
      importResult({ generationId: 'generation-2' }),
    );

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'POINTER_CHANGED',
      generationId: 'generation-2',
    });
    expect(collaborators.cutoverRepository.releaseLease).toHaveBeenCalled();
  });

  it('POINTER_CHANGED: re-import가 imported:false를 반환하면 중단한다', async () => {
    const collaborators = createCollaborators();
    collaborators.generationImportService.importActiveGeneration.mockResolvedValue(
      importResult({ imported: false, generationId: null }),
    );

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'POINTER_CHANGED',
      generationId: null,
    });
  });

  it('POINTER_CHANGED: import 왕복 이후 재조회한 포인터가 pin한 값과 달라지면 중단한다', async () => {
    const collaborators = createCollaborators();
    collaborators.canonicalRepository.getActiveGenerationSnapshot
      .mockResolvedValueOnce(snapshot({ runId: 'generation-1' }))
      .mockResolvedValueOnce(snapshot({ runId: 'generation-3' }));

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'POINTER_CHANGED',
      generationId: 'generation-3',
    });
  });

  it('UNVERIFIED_STREAMS: provider 재순회 이후에도 VERIFYING 상태가 남아 있으면 중단한다', async () => {
    const collaborators = createCollaborators();
    collaborators.cutoverRepository.countVerifyingStreams
      .mockResolvedValueOnce(2) // verifyAllStreams pass 1
      .mockResolvedValue(1); // still unverified after sync passes exhausted

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'UNVERIFIED_STREAMS',
      generationId: 'generation-1',
    });
    expect(collaborators.syncService.run).toHaveBeenCalled();
  });

  it('AGGREGATE_MISMATCH: pin된 generation 원장 개수와 새 facts 개수가 다르면 중단한다', async () => {
    const collaborators = createCollaborators();
    collaborators.cutoverRepository.countCommitFactsForRepositories.mockResolvedValue(
      0,
    );

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'ABORTED',
      reason: 'AGGREGATE_MISMATCH',
      generationId: 'generation-1',
    });
  });

  it('COMPLETED: 작성자 귀속이 없는 canonical fact는 신규 fact parity에서 제외한다', async () => {
    const collaborators = createCollaborators();
    collaborators.canonicalRepository.getActiveGenerationSnapshot.mockResolvedValue(
      snapshot({
        commits: [
          {
            githubRepositoryId: 101n,
            sha: 'anonymous'.padEnd(40, '0'),
            committedAt: new Date('2026-07-30T00:00:00.000Z'),
            authorGithubId: null,
            authorGithubLogin: null,
          },
        ],
      }),
    );
    collaborators.cutoverRepository.countCommitFactsForRepositories.mockResolvedValue(
      0,
    );
    collaborators.generationImportService.importActiveGeneration.mockResolvedValue(
      importResult({
        repositories: [
          {
            githubRepositoryId: '101',
            repositoryId: 'repo-1',
            commitsAccepted: 0,
            commitsInserted: 0,
            pullRequestsAccepted: 0,
            pullRequestsInserted: 0,
            releasesAccepted: 0,
            releasesInserted: 0,
          },
        ],
      }),
    );

    await expect(
      serviceFor(collaborators).runCutover('cli:owner-1'),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      comparison: {
        oldCommitCount: 0,
        newCommitCount: 0,
      },
    });
  });

  it('COMPLETED: 모든 단계가 통과하면 비교 결과와 함께 완료를 반환하고 lease를 해제한다', async () => {
    const collaborators = createCollaborators();

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result).toEqual({
      status: 'COMPLETED',
      generationId: 'generation-1',
      repositoryCount: 1,
      verifiedStreamCount: 0,
      syncPasses: 0,
      comparison: {
        oldCommitCount: 1,
        newCommitCount: 1,
        oldPullRequestCount: 0,
        newPullRequestCount: 0,
        oldReleaseCount: 0,
        newReleaseCount: 0,
      },
    });
    expect(collaborators.syncService.run).not.toHaveBeenCalled();
    expect(collaborators.cutoverRepository.releaseLease).toHaveBeenCalledWith(
      LEASE_TOKEN,
      expect.any(Date),
    );
  });

  it('COMPLETED: VERIFYING stream이 남아 있으면 provider를 재순회한 뒤 검증을 마친다', async () => {
    const collaborators = createCollaborators();
    collaborators.cutoverRepository.countVerifyingStreams
      .mockResolvedValueOnce(2)
      .mockResolvedValue(0);

    const result = await serviceFor(collaborators).runCutover('cli:owner-1');

    expect(result.status).toBe('COMPLETED');
    expect(collaborators.syncService.run).toHaveBeenCalledTimes(1);
    expect(collaborators.syncService.run).toHaveBeenCalledWith('cli:owner-1');
  });

  it('lease 해제 자체가 실패해도 결과를 그대로 반환한다(예외를 삼킨다)', async () => {
    const collaborators = createCollaborators();
    collaborators.cutoverRepository.releaseLease.mockRejectedValue(
      new Error('release failed'),
    );

    await expect(
      serviceFor(collaborators).runCutover('cli:owner-1'),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});
