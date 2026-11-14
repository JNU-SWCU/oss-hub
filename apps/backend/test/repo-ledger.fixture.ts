import {
  Prisma,
  PrismaClient,
  type CollectionRepositoryPresence,
  type RepositorySource,
  type RepositoryVisibility,
} from '@prisma/client';
import { RepoLedgerRepository } from '../src/platform/repo-ledger.repository';

type RepoFixtureClient = Pick<PrismaClient, '$executeRaw' | 'repo'>;

export interface RepoSeed {
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly source: RepositorySource;
  readonly teamId?: string | null;
  readonly visibility?: RepositoryVisibility;
  readonly presence?: CollectionRepositoryPresence;
  readonly defaultBranch?: string | null;
  readonly archived?: boolean;
  readonly publishedAt?: Date | null;
  readonly lastSuccessAt?: Date | null;
  readonly goneAt?: Date | null;
}

export function linkedTo(
  teamId: string | Prisma.StringFilter,
): Prisma.RepoWhereInput {
  return { teamRepos: { some: { teamId, validTo: null } } };
}

export async function repoWithTeam(
  db: Pick<PrismaClient, 'repo'>,
  githubRepoId: bigint,
) {
  const row = await db.repo.findUnique({
    where: { githubRepoId },
    include: {
      teamRepos: { where: { validTo: null }, select: { teamId: true } },
    },
  });
  if (row === null) return null;
  const { teamRepos, ...repo } = row;
  return { ...repo, teamId: teamRepos[0]?.teamId ?? null };
}

export async function seedRepo(
  db: RepoFixtureClient,
  { githubRepositoryId, nameWithOwner, teamId, ...data }: RepoSeed,
): Promise<void> {
  await db.repo.upsert({
    where: { githubRepoId: githubRepositoryId },
    create: {
      ...data,
      githubRepoId: githubRepositoryId,
      ownerName: nameWithOwner,
    },
    update: { ...data, ownerName: nameWithOwner },
  });
  if (teamId !== undefined && teamId !== null)
    await new RepoLedgerRepository().link(db, teamId, githubRepositoryId);
}

export async function seedRepos(
  db: RepoFixtureClient,
  seeds: readonly RepoSeed[],
): Promise<void> {
  for (const seed of seeds) await seedRepo(db, seed);
}

export async function unlinkRepo(
  db: Pick<PrismaClient, '$executeRaw'>,
  githubRepositoryId: bigint,
): Promise<void> {
  await db.$executeRaw`
    UPDATE "team_repo"
    SET "valid_to" = GREATEST(
      transaction_timestamp()::timestamptz(3),
      "valid_from" + interval '1 millisecond'
    )
    WHERE "repo_id" = ${githubRepositoryId} AND "valid_to" IS NULL
  `;
}

export async function relinkRepo(
  db: Pick<PrismaClient, '$executeRaw'>,
  githubRepositoryId: bigint,
  teamId: string,
): Promise<void> {
  await unlinkRepo(db, githubRepositoryId);
  await new RepoLedgerRepository().link(db, teamId, githubRepositoryId);
}

export async function deleteRepos(
  db: Pick<PrismaClient, '$executeRaw' | '$queryRaw'>,
  githubRepositoryIds: readonly bigint[],
  teamIds: readonly string[] = [],
): Promise<void> {
  const linked =
    teamIds.length === 0
      ? []
      : await db.$queryRaw<readonly { repo_id: bigint }[]>`
          SELECT DISTINCT "repo_id"
          FROM "team_repo"
          WHERE "team_id" IN (${Prisma.join(teamIds)})
        `;
  const ids = [
    ...new Set([...githubRepositoryIds, ...linked.map((row) => row.repo_id)]),
  ];
  if (ids.length === 0) return;
  await db.$executeRaw`
    UPDATE "RepositoryProvisionJob" SET "repo_id" = NULL
    WHERE "repo_id" IN (${Prisma.join(ids)})
  `;
  await db.$executeRaw`
    DELETE FROM "RepositoryInvitation" WHERE "repo_id" IN (${Prisma.join(ids)})
  `;
  await new RepoLedgerRepository().remove(db, ids);
}
