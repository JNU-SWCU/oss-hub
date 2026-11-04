import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RepositoryDeletionCounts } from './repository-audit-metadata.config';

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
      'commits', (SELECT count(*) FROM "CollectionCommitFact" WHERE "repositoryId" = ${repositoryId}),
      'contributions', (SELECT count(*) FROM "Contribution" WHERE "repositoryId" = ${repositoryId}),
      'streams', (SELECT count(*) FROM "CollectionRepositoryStream" WHERE "repositoryId" = ${repositoryId}),
      'pullRequests', (SELECT count(*) FROM "CollectionPullRequestFact" WHERE "repositoryId" = ${repositoryId}),
      'releases', (SELECT count(*) FROM "CollectionReleaseFact" WHERE "repositoryId" = ${repositoryId}),
      'issues', (SELECT count(*) FROM "GithubIssueHistory" WHERE "repositoryId" = ${repositoryId}),
      'outsiders', (SELECT count(*) FROM "GithubRepositoryOutsiderContribution" WHERE "repositoryId" = ${repositoryId}),
      'invitations', (SELECT count(*) FROM "RepositoryInvitation" WHERE "repositoryId" = ${repositoryId}),
      'repositoryYearAggregates', (SELECT count(*) FROM "CollectionRepositoryYearAggregate" WHERE "repositoryId" = ${repositoryId}),
      'contributorYearAggregates', (SELECT count(*) FROM "CollectionContributorYearAggregate" WHERE "repositoryId" = ${repositoryId})
    ) AS counts
  `;
    await transaction.repositoryProvisionJob.updateMany({
      where: { repositoryId },
      data: { repositoryId: null },
    });
    await transaction.repositoryInvitation.deleteMany({
      where: { repositoryId },
    });
    await transaction.githubRepository.delete({ where: { id: repositoryId } });
    return row.counts;
  }
}
