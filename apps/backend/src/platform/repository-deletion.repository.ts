import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RepositoryDeletionCounts } from './repository-audit-metadata.config';
import { RepoLedgerRepository } from './repo-ledger.repository';

@Injectable()
export class RepositoryDeletionRepository {
  async deleteRepositoryWithFacts(
    transaction: Prisma.TransactionClient,
    githubRepositoryId: bigint,
  ): Promise<RepositoryDeletionCounts> {
    await transaction.$queryRaw`
    SELECT github_repo_id FROM "repo" WHERE github_repo_id = ${githubRepositoryId} FOR UPDATE
  `;
    const [row] = await transaction.$queryRaw<
      readonly [{ readonly counts: RepositoryDeletionCounts }]
    >`
    SELECT json_build_object(
      'repositories', (SELECT count(*) FROM "repo" WHERE github_repo_id = ${githubRepositoryId}),
      'commits', (
        SELECT count(*) FROM "contribution"
        WHERE repo_id = ${githubRepositoryId} AND kind = 'commit'::"contribution_kind"
      ),
      'contributions', (
        SELECT count(DISTINCT (
          event.author_github_id,
          (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date
        ))
        FROM "contribution" AS event
        WHERE event.repo_id = ${githubRepositoryId}
          AND event.author_github_id IS NOT NULL
      ),
      'pullRequests', (
        SELECT count(*) FROM "contribution"
        WHERE repo_id = ${githubRepositoryId} AND kind = 'pull_request'::"contribution_kind"
      ),
      'releases', (
        SELECT count(*) FROM "contribution"
        WHERE repo_id = ${githubRepositoryId} AND kind = 'release'::"contribution_kind"
      ),
      'issues', (
        SELECT count(*) FROM "contribution"
        WHERE repo_id = ${githubRepositoryId} AND kind = 'issue'::"contribution_kind"
      ),
      'invitations', (SELECT count(*) FROM "RepositoryInvitation" WHERE repo_id = ${githubRepositoryId})
    ) AS counts
  `;
    await transaction.repositoryProvisionJob.updateMany({
      where: { repoId: githubRepositoryId },
      data: { repositoryId: null, repoId: null },
    });
    await transaction.repositoryInvitation.deleteMany({
      where: { repoId: githubRepositoryId },
    });
    await new RepoLedgerRepository().remove(transaction, [githubRepositoryId]);
    return row.counts;
  }
}
