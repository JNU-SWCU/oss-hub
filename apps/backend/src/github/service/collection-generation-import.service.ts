import { createHash } from 'node:crypto';
import type {
  CanonicalCommitSnapshotRow,
  CanonicalGenerationSnapshot,
  CanonicalLeaseKey,
  CanonicalPullRequestRow,
  CanonicalReleaseRow,
  CanonicalRepositoryRow,
} from '../collection-canonical.types';
import type { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import type { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import type {
  CollectionStreamType,
  RegisteredGithubIdSet,
} from '../collection-incremental.types';

/**
 * ADR-006 조직 전체 누적·증분 수집 계약의 backfill entry point (public-admin-exposure
 * todo 8). 최신 성공 활성 generation(CanonicalOrganizationState.activeGenerationId)의
 * repository/commit/pull request/release 원장을 읽어 stable-ID facts + baseline
 * year aggregate로 1회 변환한다.
 *
 * 이 command는 ETag·safe frontier·list order를 발명하지 않는다 — legacy generation은
 * 이 정보를 보존하지 않으므로 import된 stream은 항상 `VERIFYING`으로 남고 frontier
 * 필드는 모두 null로 남는다. 최초 provider traversal(별도 todo의 sync orchestration)만
 * safe frontier를 확립하고 stream을 `READY`로 승격할 수 있다.
 *
 * Idempotency는 새 코드가 아니라 기존 `CollectionIncrementalRepository`의 unique-key
 * 계약에서 나온다 — fact insert는 중복 unique key를 조용히 건너뛰고, aggregate
 * increment는 그 insert가 성공했을 때만 일어난다. 따라서 같은 generation을 여러 번
 * import해도 최종 행/집계는 동일하다.
 */

const COLLECTION_STREAM_TYPES_TO_VERIFY: readonly CollectionStreamType[] = [
  'COMMIT',
  'PULL_REQUEST',
  'RELEASE',
];

export interface GenerationImportRepositoryResult {
  readonly githubRepositoryId: string;
  readonly repositoryId: string;
  readonly commitsAccepted: number;
  readonly commitsInserted: number;
  readonly pullRequestsAccepted: number;
  readonly pullRequestsInserted: number;
  readonly releasesAccepted: number;
  readonly releasesInserted: number;
}

export interface GenerationImportResult {
  readonly imported: boolean;
  readonly generationId: string | null;
  readonly repositoryCount: number;
  readonly repositories: readonly GenerationImportRepositoryResult[];
  readonly digest: string;
}

const compareBigint = (a: bigint, b: bigint): number =>
  a < b ? -1 : a > b ? 1 : 0;

interface GroupedRepository {
  readonly repository: CanonicalRepositoryRow;
  readonly commits: CanonicalCommitSnapshotRow[];
  readonly pullRequests: CanonicalPullRequestRow[];
  readonly releases: CanonicalReleaseRow[];
}

function groupSnapshotByRepository(
  snapshot: CanonicalGenerationSnapshot,
): GroupedRepository[] {
  const groups = new Map<bigint, GroupedRepository>();
  for (const repository of snapshot.repositories) {
    groups.set(repository.githubRepositoryId, {
      repository,
      commits: [],
      pullRequests: [],
      releases: [],
    });
  }
  for (const commit of snapshot.commits) {
    groups.get(commit.githubRepositoryId)?.commits.push(commit);
  }
  for (const pullRequest of snapshot.pullRequests) {
    groups.get(pullRequest.githubRepositoryId)?.pullRequests.push(pullRequest);
  }
  for (const release of snapshot.releases) {
    groups.get(release.githubRepositoryId)?.releases.push(release);
  }
  return [...groups.values()].sort((left, right) =>
    compareBigint(
      left.repository.githubRepositoryId,
      right.repository.githubRepositoryId,
    ),
  );
}

/**
 * Pure, deterministic digest over the immutable published generation itself
 * (not over insert side effects) — the same generation always yields the
 * same digest, on the first import and on every re-run.
 */
export function computeGenerationImportDigest(
  generationId: string,
  groups: readonly GroupedRepository[],
): string {
  const normalized = JSON.stringify({
    generationId,
    repositories: groups.map(
      ({ repository, commits, pullRequests, releases }) => ({
        githubRepositoryId: repository.githubRepositoryId.toString(),
        fullName: repository.fullName,
        visibility: repository.visibility.toUpperCase(),
        archived: repository.archived,
        defaultBranch: repository.defaultBranch,
        commits: [...commits]
          .sort((a, b) => a.sha.localeCompare(b.sha))
          .map((commit) => ({
            sha: commit.sha,
            committedAt: commit.committedAt.toISOString(),
            authorGithubId: commit.authorGithubId?.toString() ?? null,
            authorGithubLogin: commit.authorGithubLogin ?? null,
          })),
        pullRequests: [...pullRequests]
          .sort((a, b) =>
            compareBigint(a.githubPullRequestId, b.githubPullRequestId),
          )
          .map((pullRequest) => ({
            githubPullRequestId: pullRequest.githubPullRequestId.toString(),
            state: pullRequest.state,
            createdAt: pullRequest.createdAt.toISOString(),
            authorGithubId: pullRequest.authorGithubId?.toString() ?? null,
            authorGithubLogin: pullRequest.authorGithubLogin ?? null,
          })),
        releases: [...releases]
          .sort((a, b) => compareBigint(a.githubReleaseId, b.githubReleaseId))
          .map((release) => ({
            githubReleaseId: release.githubReleaseId.toString(),
            publishedAt: release.publishedAt.toISOString(),
            authorGithubId: release.authorGithubId?.toString() ?? null,
            authorGithubLogin: release.authorGithubLogin ?? null,
          })),
      }),
    ),
  });
  return createHash('sha256').update(normalized).digest('hex');
}

const EMPTY_DIGEST = createHash('sha256')
  .update(JSON.stringify({ generationId: null, repositories: [] }))
  .digest('hex');

export class CollectionGenerationImportService {
  constructor(
    private readonly canonicalRepository: Pick<
      CollectionCanonicalRepository,
      'getActiveGenerationSnapshot'
    >,
    private readonly incrementalRepository: Pick<
      CollectionIncrementalRepository,
      'listRegisteredGithubIds' | 'runInTransaction'
    >,
    private readonly resolveGithubOrganizationId: () => Promise<bigint>,
  ) {}

  async importActiveGeneration(
    key: CanonicalLeaseKey,
    registeredGithubIds?: RegisteredGithubIdSet,
  ): Promise<GenerationImportResult> {
    const snapshot =
      await this.canonicalRepository.getActiveGenerationSnapshot(key);
    if (!snapshot) {
      return {
        imported: false,
        generationId: null,
        repositoryCount: 0,
        repositories: [],
        digest: EMPTY_DIGEST,
      };
    }

    // D9 — import 전체가 같은 가입자 snapshot을 공유한다. 조회 실패는 첫 저장소 write 전에
    // 전파되어 canonical 데이터보다 개인 식별자 유입을 fail-closed 한다.
    const identitySnapshot =
      registeredGithubIds ??
      (await this.incrementalRepository.listRegisteredGithubIds());
    const groups = groupSnapshotByRepository(snapshot);
    const githubOrganizationId = await this.resolveGithubOrganizationId();
    const repositories: GenerationImportRepositoryResult[] = [];

    for (const group of groups) {
      const result = await this.incrementalRepository.runInTransaction(
        async (repo) => {
          const row = await repo.recordRepositoryObservation({
            githubOrganizationId,
            githubRepositoryId: group.repository.githubRepositoryId,
            nameWithOwner: group.repository.fullName,
            defaultBranch: group.repository.defaultBranch,
            archived: group.repository.archived,
            visibility:
              group.repository.visibility.toUpperCase() === 'PUBLIC'
                ? 'PUBLIC'
                : 'PRIVATE',
            presence: 'PRESENT',
            // Legacy canonical generations only ever held org installation
            // repositories — external public repos did not exist in that
            // model, so backfill import always claims ORG_PROVISIONED.
            source: 'ORG_PROVISIONED',
            observedAt: snapshot.finishedAt,
          });

          const commits = await repo.recordCommitFacts(
            row.id,
            group.commits.map((commit) => ({
              sha: commit.sha,
              committedAt: commit.committedAt,
              authorGithubId: commit.authorGithubId,
              authorGithubLogin: commit.authorGithubLogin,
            })),
            identitySnapshot,
          );
          const pullRequests = await repo.recordPullRequestFacts(
            row.id,
            group.pullRequests.map((pullRequest) => ({
              githubPullRequestId: pullRequest.githubPullRequestId,
              state: pullRequest.state,
              createdAt: pullRequest.createdAt,
              authorGithubId: pullRequest.authorGithubId,
              authorGithubLogin: pullRequest.authorGithubLogin,
            })),
            identitySnapshot,
          );
          const releases = await repo.recordReleaseFacts(
            row.id,
            group.releases.map((release) => ({
              githubReleaseId: release.githubReleaseId,
              publishedAt: release.publishedAt,
              authorGithubId: release.authorGithubId,
              authorGithubLogin: release.authorGithubLogin,
            })),
            identitySnapshot,
          );

          for (const streamType of COLLECTION_STREAM_TYPES_TO_VERIFY) {
            // Only claim a fresh stream row — never stomp state a later,
            // more-authoritative provider traversal (todo 10) already
            // established (e.g. READY with a real safe frontier).
            const existing = await repo.getStreamFrontier(row.id, streamType);
            if (existing) continue;
            await repo.upsertStreamFrontier({
              repositoryId: row.id,
              streamType,
              status: 'VERIFYING',
            });
          }

          return {
            githubRepositoryId: group.repository.githubRepositoryId.toString(),
            repositoryId: row.id,
            commitsAccepted: commits.acceptedCount,
            commitsInserted: commits.insertedCount,
            pullRequestsAccepted: pullRequests.acceptedCount,
            pullRequestsInserted: pullRequests.insertedCount,
            releasesAccepted: releases.acceptedCount,
            releasesInserted: releases.insertedCount,
          };
        },
      );
      repositories.push(result);
    }

    return {
      imported: true,
      generationId: snapshot.runId,
      repositoryCount: repositories.length,
      repositories,
      digest: computeGenerationImportDigest(snapshot.runId, groups),
    };
  }
}
