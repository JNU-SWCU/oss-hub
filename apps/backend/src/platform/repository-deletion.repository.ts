import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RepositoryDeletionCounts } from './repository-audit-metadata.config';
import { RepoLedgerRepository } from './repo-ledger.repository';

@Injectable()
export class RepositoryDeletionRepository {
  async deleteRepositoryWithFacts(
    transaction: Prisma.TransactionClient,
    repositoryId: string,
  ): Promise<RepositoryDeletionCounts> {
    await transaction.$queryRaw`
    SELECT id FROM "GithubRepository" WHERE id = ${repositoryId} FOR UPDATE
  `;
    const [row] = await transaction.$queryRaw<
      readonly [{ readonly counts: RepositoryDeletionCounts }]
    >`
    SELECT json_build_object(
      'repositories', (SELECT count(*) FROM "GithubRepository" WHERE id = ${repositoryId}),
      'commits', (
        SELECT count(*) FROM "contribution" AS event
        JOIN "GithubRepository" AS repository
          ON repository."githubRepositoryId" = event.repo_id
        WHERE repository.id = ${repositoryId}
          AND event.kind = 'commit'::"contribution_kind"
      ),
      'contributions', (
        SELECT count(*) FROM repo_contribution
        WHERE repository_id = ${repositoryId}
      ),
      'streams', (SELECT count(*) FROM "CollectionRepositoryStream" WHERE "repositoryId" = ${repositoryId}),
      'pullRequests', (
        SELECT count(*) FROM "contribution" AS event
        JOIN "GithubRepository" AS repository
          ON repository."githubRepositoryId" = event.repo_id
        WHERE repository.id = ${repositoryId}
          AND event.kind = 'pull_request'::"contribution_kind"
      ),
      'releases', (
        SELECT count(*) FROM "contribution" AS event
        JOIN "GithubRepository" AS repository
          ON repository."githubRepositoryId" = event.repo_id
        WHERE repository.id = ${repositoryId}
          AND event.kind = 'release'::"contribution_kind"
      ),
      'issues', (
        SELECT count(*) FROM "contribution" AS event
        JOIN "GithubRepository" AS repository
          ON repository."githubRepositoryId" = event.repo_id
        WHERE repository.id = ${repositoryId}
          AND event.kind = 'issue'::"contribution_kind"
      ),
      'invitations', (SELECT count(*) FROM "RepositoryInvitation" WHERE "repositoryId" = ${repositoryId})
    ) AS counts
  `;
    await transaction.repositoryProvisionJob.updateMany({
      where: { repositoryId },
      data: { repositoryId: null },
    });
    await transaction.repositoryInvitation.deleteMany({
      where: { repositoryId },
    });
    const deleted = await transaction.githubRepository.delete({
      where: { id: repositoryId },
      select: { githubRepositoryId: true },
    });
    await new RepoLedgerRepository().remove(transaction, [
      deleted.githubRepositoryId,
    ]);
    return row.counts;
  }
}
