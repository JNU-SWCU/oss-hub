import type {
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
  CollectionIssue,
} from './collection-app.client';
import type { RegisteredGithubIdSet } from './collection-incremental.types';
import type { SyncLeaseToken } from './collection-sync.types';
import type { CollectionIncrementalRepository } from './collection-incremental.repository';

function bigIntOrNull(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

export class CollectionStreamCheckpoint {
  constructor(
    private readonly incrementalRepository: Pick<
      CollectionIncrementalRepository,
      'runInTransaction'
    >,
    private readonly now: () => Date,
  ) {}

  async commitCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    commits: readonly CollectionCommit[],
    registeredGithubIds: RegisteredGithubIdSet,
    headSha: string | null,
    requestFingerprint: string,
    etag: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordCommitFacts(
        repositoryId,
        commits.map((commit) => ({
          sha: commit.sha,
          committedAt: new Date(commit.committedAt),
          authorGithubId: bigIntOrNull(commit.authorGithubId),
          authorGithubLogin: commit.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'COMMIT',
        status: 'READY',
        frontierSha: headSha,
        requestFingerprint,
        etag,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  async pullRequestCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    pullRequests: readonly CollectionPullRequest[],
    registeredGithubIds: RegisteredGithubIdSet,
    newFrontier: { createdAt: string; id: string } | null,
    requestFingerprint: string,
    teamMembershipFrontier: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordPullRequestFacts(
        repositoryId,
        pullRequests.map((pullRequest) => ({
          githubPullRequestId: BigInt(pullRequest.id),
          state: pullRequest.state,
          createdAt: new Date(pullRequest.createdAt),
          authorGithubId: bigIntOrNull(pullRequest.authorGithubId),
          authorGithubLogin: pullRequest.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'PULL_REQUEST',
        status: 'READY',
        frontierSha: teamMembershipFrontier,
        frontierCreatedAt: newFrontier ? new Date(newFrontier.createdAt) : null,
        frontierEntityId: newFrontier ? BigInt(newFrontier.id) : null,
        requestFingerprint,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  async releaseCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    releases: readonly CollectionRelease[],
    registeredGithubIds: RegisteredGithubIdSet,
    frontierProbe: string | null,
    requestFingerprint: string,
    etag: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordReleaseFacts(
        repositoryId,
        releases.map((release) => ({
          githubReleaseId: BigInt(release.id),
          publishedAt: new Date(release.publishedAt),
          authorGithubId: bigIntOrNull(release.authorGithubId),
          authorGithubLogin: release.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'RELEASE',
        status: 'READY',
        frontierSha: frontierProbe,
        requestFingerprint,
        etag,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  async issueCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    issues: readonly CollectionIssue[],
    registeredGithubIds: RegisteredGithubIdSet,
    newFrontier: { createdAt: string; id: string } | null,
    requestFingerprint: string,
    teamMembershipFrontier: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordIssueFacts(
        repositoryId,
        issues.map((issue) => ({
          githubIssueId: BigInt(issue.id),
          state: issue.state,
          createdAt: new Date(issue.createdAt),
          authorGithubId: bigIntOrNull(issue.authorGithubId),
          authorGithubLogin: issue.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'ISSUE',
        status: 'READY',
        frontierSha: teamMembershipFrontier,
        frontierCreatedAt: newFrontier ? new Date(newFrontier.createdAt) : null,
        frontierEntityId: newFrontier ? BigInt(newFrontier.id) : null,
        requestFingerprint,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }
}
