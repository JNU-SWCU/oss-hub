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

export async function syncGithubRepositoryLedger(
  db: Pick<PrismaClient, '$executeRaw'>,
  githubRepositoryId: bigint,
): Promise<void> {
  await db.$executeRaw`
    UPDATE "team_repo" AS link
    SET "valid_to" = GREATEST(
      transaction_timestamp()::timestamptz(3),
      link."valid_from" + interval '1 millisecond'
    )
    WHERE link."valid_to" IS NULL
      AND (
        link."repo_id" = ${githubRepositoryId}
        OR link."team_id" IN (
          SELECT repository."teamId"
          FROM "GithubRepository" AS repository
          WHERE repository."githubRepositoryId" = ${githubRepositoryId}
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "GithubRepository" AS repository
        WHERE repository."githubRepositoryId" = link."repo_id"
          AND repository."teamId" = link."team_id"
      )
  `;
  await new RepoLedgerRepository().link(db, githubRepositoryId);
}

export async function syncGithubRepositoryLedgers(
  db: Pick<PrismaClient, '$executeRaw' | 'githubRepository'>,
  where: Prisma.GithubRepositoryWhereInput,
): Promise<void> {
  const repositories = await db.githubRepository.findMany({
    where,
    select: { githubRepositoryId: true },
    orderBy: { githubRepositoryId: 'asc' },
  });
  for (const { githubRepositoryId } of repositories)
    await syncGithubRepositoryLedger(db, githubRepositoryId);
}
