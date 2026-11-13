import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type RepoLedgerClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

@Injectable()
export class RepoLedgerRepository {
  async write(db: RepoLedgerClient, githubRepositoryId: bigint): Promise<void> {
    await db.$executeRaw`
      INSERT INTO "repo" (
        "github_repo_id",
        "owner_name",
        "source",
        "gone_at",
        "default_branch",
        "archived",
        "visibility",
        "presence",
        "published_at"
      )
      SELECT
        repository."githubRepositoryId",
        repository."nameWithOwner",
        repository."source",
        CASE
          WHEN repository."presence" = 'ABSENT'
          THEN repository."updatedAt" AT TIME ZONE 'UTC'
          ELSE NULL
        END,
        repository."defaultBranch",
        repository."archived",
        repository."visibility",
        repository."presence",
        repository."publishedAt" AT TIME ZONE 'UTC'
      FROM "GithubRepository" AS repository
      WHERE repository."githubRepositoryId" = ${githubRepositoryId}
      ON CONFLICT ("github_repo_id") DO UPDATE
      SET
        "owner_name" = EXCLUDED."owner_name",
        "source" = EXCLUDED."source",
        "gone_at" = EXCLUDED."gone_at",
        "default_branch" = EXCLUDED."default_branch",
        "archived" = EXCLUDED."archived",
        "visibility" = EXCLUDED."visibility",
        "presence" = EXCLUDED."presence",
        "published_at" = EXCLUDED."published_at"
    `;
  }

  async link(db: RepoLedgerClient, githubRepositoryId: bigint): Promise<void> {
    await this.write(db, githubRepositoryId);
    await db.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      SELECT
        repository."teamId",
        repository."githubRepositoryId",
        GREATEST(
          transaction_timestamp()::timestamptz(3),
          (
            SELECT MAX(period."valid_to")
            FROM "team_repo" AS period
            WHERE period."repo_id" = repository."githubRepositoryId"
              OR period."team_id" = repository."teamId"
          )
        )
      FROM "GithubRepository" AS repository
      JOIN "Team" AS team
        ON team."id" = repository."teamId"
       AND team."archivedAt" IS NULL
      WHERE repository."githubRepositoryId" = ${githubRepositoryId}
        AND NOT EXISTS (
          SELECT 1
          FROM "team_repo" AS open_period
          WHERE open_period."repo_id" = repository."githubRepositoryId"
            AND open_period."team_id" = repository."teamId"
            AND open_period."valid_to" IS NULL
        )
    `;
  }

  async remove(
    db: RepoLedgerClient,
    githubRepositoryIds: readonly bigint[],
  ): Promise<void> {
    if (githubRepositoryIds.length === 0) return;
    const ids = Prisma.join(githubRepositoryIds);
    await db.$executeRaw`DELETE FROM "contribution" WHERE "repo_id" IN (${ids})`;
    await db.$executeRaw`DELETE FROM "team_repo" WHERE "repo_id" IN (${ids})`;
    await db.$executeRaw`DELETE FROM "repo" WHERE "github_repo_id" IN (${ids})`;
  }
}
