import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import type { CanonicalLeaseKey } from '../collection-canonical.types';
import type { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import type {
  CutoverAggregateComparison,
  CutoverLeaseToken,
  CutoverResult,
} from '../collection-cutover.types';
import type { CollectionGenerationImportService } from './collection-generation-import.service';
import type { CollectionSyncService } from './collection-sync.service';

const LEASE_MS = 4 * 60 * 60_000; // 4h — 사람이 지켜보는 1회성 운영 절차를 넉넉히 감싼다.
const MAX_SYNC_PASSES = 20;

/**
 * ADR-006 "누적 저장소로의 1회 전환" 절차(public-admin-exposure todo 14)의 orchestration.
 * `CollectionCutoverLease`(quiesce) 아래에서: (1) 마지막 성공 generation을 pin하고,
 * (2) todo 8 backfill(`CollectionGenerationImportService`)을 재실행해 idempotent하게
 * 다시 채우고, (3) pin된 포인터가 그 사이 바뀌지 않았는지 확인하고, (4) todo 10 provider
 * traversal(`CollectionSyncService`)로 VERIFYING stream을 모두 검증하고, (5) pin된 generation
 * 중 가입자 경계를 통과한 원장 개수와 새 facts 개수를 비교한다. 다섯 단계 중 어느 하나라도 실패하면 명시적
 * `CutoverAbortReason`과 함께 ABORTED를 반환한다 — 예외를 던지거나 조용히 넘어가지 않는다.
 * 성공/실패 무관하게 quiesce lease는 항상 해제한다(스케줄러/관리자 트리거가 다시 열리도록).
 */
export class CollectionCutoverService {
  private readonly logger = new Logger(CollectionCutoverService.name);

  constructor(
    private readonly canonicalRepository: Pick<
      CollectionCanonicalRepository,
      'getActiveGenerationSnapshot'
    >,
    private readonly generationImportService: Pick<
      CollectionGenerationImportService,
      'importActiveGeneration'
    >,
    private readonly syncService: Pick<CollectionSyncService, 'run'>,
    private readonly cutoverRepository: CollectionCutoverRepository,
    private readonly resolveKey: () => Promise<CanonicalLeaseKey>,
    private readonly now: () => Date = () => new Date(),
    private readonly createRunId: () => string = randomUUID,
  ) {}

  async runCutover(ownerId: string): Promise<CutoverResult> {
    const key = await this.resolveKey();
    const runId = this.createRunId();
    const acquiredAt = this.now();
    const lease = await this.cutoverRepository.acquireLease({
      appId: key.appId,
      // Cutover is the org-sweep atomic conversion procedure — it has no
      // external-sweep counterpart yet, so it always uses the org scope
      // convention (see `collection-sync.types.ts`'s `SyncLeaseKey`).
      scope: `org:${key.organizationLogin}`,
      ownerId,
      runId,
      now: acquiredAt,
      expiresAt: new Date(acquiredAt.getTime() + LEASE_MS),
    });
    if (!lease) {
      return {
        status: 'ABORTED',
        reason: 'ALREADY_IN_PROGRESS',
        generationId: null,
      };
    }

    try {
      return await this.runPinnedCutover(key, ownerId);
    } finally {
      await this.releaseLeaseQuietly(lease);
    }
  }

  private async releaseLeaseQuietly(lease: CutoverLeaseToken): Promise<void> {
    try {
      await this.cutoverRepository.releaseLease(lease, this.now());
    } catch (error) {
      this.logger.error({
        event: 'collection.cutover.lease_release_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async runPinnedCutover(
    key: CanonicalLeaseKey,
    ownerId: string,
  ): Promise<CutoverResult> {
    const before =
      await this.canonicalRepository.getActiveGenerationSnapshot(key);
    if (!before) {
      return { status: 'ABORTED', reason: 'NO_GENERATION', generationId: null };
    }

    const importResult =
      await this.generationImportService.importActiveGeneration(key);
    if (!importResult.imported || importResult.generationId !== before.runId) {
      return {
        status: 'ABORTED',
        reason: 'POINTER_CHANGED',
        generationId: importResult.generationId,
      };
    }

    // Pin assertion: re-read the pointer after the re-import round-trip and
    // require it to be the exact same generation we started from.
    const after =
      await this.canonicalRepository.getActiveGenerationSnapshot(key);
    if (!after || after.runId !== before.runId) {
      return {
        status: 'ABORTED',
        reason: 'POINTER_CHANGED',
        generationId: after?.runId ?? null,
      };
    }

    const syncPasses = await this.verifyAllStreams(ownerId);
    const verifiedStreamCount =
      await this.cutoverRepository.countVerifyingStreams();
    if (verifiedStreamCount > 0) {
      return {
        status: 'ABORTED',
        reason: 'UNVERIFIED_STREAMS',
        generationId: before.runId,
      };
    }

    const comparison = await this.compareAggregates(importResult);
    if (!aggregatesMatch(comparison)) {
      return {
        status: 'ABORTED',
        reason: 'AGGREGATE_MISMATCH',
        generationId: before.runId,
      };
    }

    return {
      status: 'COMPLETED',
      generationId: before.runId,
      repositoryCount: importResult.repositoryCount,
      verifiedStreamCount: 0,
      syncPasses,
      comparison,
    };
  }

  /**
   * `CollectionSyncService.run()`은 rate-limit 예산에 걸리면 한 사이클을 여러 호출로
   * 나눠 완주한다(`cycleCompleted`) — 안전 상한(MAX_SYNC_PASSES) 안에서 완주하거나 더 이상
   * 진행되지 않을 때까지(FAILED/SKIPPED) 반복한다.
   */
  private async verifyAllStreams(ownerId: string): Promise<number> {
    let passes = 0;
    for (; passes < MAX_SYNC_PASSES; passes += 1) {
      const remainingBefore =
        await this.cutoverRepository.countVerifyingStreams();
      if (remainingBefore === 0) break;
      const result = await this.syncService.run(ownerId);
      if (result.status !== 'COMPLETED') break;
      if (result.cycleCompleted) {
        passes += 1;
        break;
      }
    }
    return passes;
  }

  private async compareAggregates(importResult: {
    repositories: readonly {
      repositoryId: string;
      commitsAccepted: number;
      pullRequestsAccepted: number;
      releasesAccepted: number;
    }[];
  }): Promise<CutoverAggregateComparison> {
    const repositoryIds = importResult.repositories.map(
      (repository) => repository.repositoryId,
    );
    const [newCommitCount, newPullRequestCount, newReleaseCount] =
      await Promise.all([
        this.cutoverRepository.countCommitFactsForRepositories(repositoryIds),
        this.cutoverRepository.countPullRequestFactsForRepositories(
          repositoryIds,
        ),
        this.cutoverRepository.countReleaseFactsForRepositories(repositoryIds),
      ]);
    return {
      oldCommitCount: importResult.repositories.reduce(
        (sum, repository) => sum + repository.commitsAccepted,
        0,
      ),
      newCommitCount,
      oldPullRequestCount: importResult.repositories.reduce(
        (sum, repository) => sum + repository.pullRequestsAccepted,
        0,
      ),
      newPullRequestCount,
      oldReleaseCount: importResult.repositories.reduce(
        (sum, repository) => sum + repository.releasesAccepted,
        0,
      ),
      newReleaseCount,
    };
  }
}

function aggregatesMatch(comparison: CutoverAggregateComparison): boolean {
  return (
    comparison.oldCommitCount === comparison.newCommitCount &&
    comparison.oldPullRequestCount === comparison.newPullRequestCount &&
    comparison.oldReleaseCount === comparison.newReleaseCount
  );
}
