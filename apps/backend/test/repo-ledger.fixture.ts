import { Prisma, PrismaClient } from '@prisma/client';
import { RepoLedgerRepository } from '../src/platform/repo-ledger.repository';

type RepoLedgerFixtureClient = Pick<
  PrismaClient,
  '$executeRaw' | '$queryRaw' | 'githubRepository'
>;

export async function deleteGithubRepositories(
  db: RepoLedgerFixtureClient,
  where: Prisma.GithubRepositoryWhereInput,
  teamIds: readonly string[] = [],
): Promise<void> {
  const repositories = await db.githubRepository.findMany({
    where,
    select: { githubRepositoryId: true },
  });
  const linked =
    teamIds.length === 0
      ? []
      : await db.$queryRaw<readonly { repo_id: bigint }[]>`
          SELECT DISTINCT "repo_id"
          FROM "team_repo"
          WHERE "team_id" IN (${Prisma.join(teamIds)})
        `;
  await new RepoLedgerRepository().remove(db, [
    ...new Set([
      ...repositories.map((repository) => repository.githubRepositoryId),
      ...linked.map((row) => row.repo_id),
    ]),
  ]);
  await db.githubRepository.deleteMany({ where });
}
