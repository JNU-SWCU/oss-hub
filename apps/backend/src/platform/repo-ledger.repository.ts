import { Injectable } from '@nestjs/common';
import {
  CollectionRepositoryPresence,
  Prisma,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';

type RepoLedgerClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

type RepoMirrorClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw' | 'githubRepository'
>;

export interface RepoClaim {
  readonly teamId: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
  readonly source: RepositorySource;
  readonly inventory?: {
    readonly defaultBranch: string | null;
    readonly archived: boolean;
    readonly observedAt: Date;
  };
}

export interface RepoObservation {
  readonly lastCompleteInventoryObservedAt: Date | null;
  readonly updatedAt: Date;
}

export interface RepoInventory {
  readonly githubRepositoryId: bigint;
  readonly source: RepositorySource;
  readonly observedAt: Date;
  readonly nameWithOwner?: string;
  readonly defaultBranch?: string | null;
  readonly archived?: boolean;
  readonly visibility?: RepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
}

@Injectable()
export class RepoLedgerRepository {
  async claim(db: RepoMirrorClient, input: RepoClaim): Promise<void> {
    const data = {
      teamId: input.teamId,
      nameWithOwner: input.nameWithOwner,
      visibility: input.visibility,
      source: input.source,
      presence: CollectionRepositoryPresence.PRESENT,
      ...(input.inventory === undefined
        ? {}
        : {
            defaultBranch: input.inventory.defaultBranch,
            archived: input.inventory.archived,
            lastCompleteInventoryObservedAt: input.inventory.observedAt,
          }),
    };
    await db.githubRepository.upsert({
      where: { githubRepositoryId: input.githubRepositoryId },
      create: { ...data, githubRepositoryId: input.githubRepositoryId },
      update: data,
    });
    await this.link(db, input.githubRepositoryId);
  }

  async publish(
    db: RepoMirrorClient,
    githubRepositoryId: bigint,
    publishedAt: Date,
  ): Promise<boolean> {
    const updated = await db.githubRepository.updateMany({
      where: {
        githubRepositoryId,
        visibility: RepositoryVisibility.PRIVATE,
      },
      data: { visibility: RepositoryVisibility.PUBLIC, publishedAt },
    });
    await this.write(db, githubRepositoryId);
    return updated.count === 1;
  }

  async observe(db: RepoMirrorClient, input: RepoInventory): Promise<boolean> {
    const updated = await db.githubRepository.updateMany({
      where: {
        githubRepositoryId: input.githubRepositoryId,
        source: input.source,
      },
      data: {
        nameWithOwner: input.nameWithOwner,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: input.presence,
        lastCompleteInventoryObservedAt: input.observedAt,
      },
    });
    if (updated.count === 0) return false;
    await this.write(db, input.githubRepositoryId);
    return true;
  }

  async rowId(
    db: Pick<Prisma.TransactionClient, 'githubRepository'>,
    githubRepositoryId: bigint,
  ): Promise<string | null> {
    const row = await db.githubRepository.findUnique({
      where: { githubRepositoryId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async observations(
    db: Pick<Prisma.TransactionClient, 'githubRepository'>,
    githubRepositoryIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, RepoObservation>> {
    const rows = await db.githubRepository.findMany({
      where: { githubRepositoryId: { in: [...githubRepositoryIds] } },
      select: {
        githubRepositoryId: true,
        lastCompleteInventoryObservedAt: true,
        updatedAt: true,
      },
    });
    return new Map(
      rows.map((row) => [
        row.githubRepositoryId,
        {
          lastCompleteInventoryObservedAt: row.lastCompleteInventoryObservedAt,
          updatedAt: row.updatedAt,
        },
      ]),
    );
  }

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
  ): Promise<number> {
    if (githubRepositoryIds.length === 0) return 0;
    const ids = Prisma.join(githubRepositoryIds);
    const removed = await db.$executeRaw`
      DELETE FROM "GithubRepository" WHERE "githubRepositoryId" IN (${ids})
    `;
    await db.$executeRaw`DELETE FROM "contribution" WHERE "repo_id" IN (${ids})`;
    await db.$executeRaw`DELETE FROM "team_repo" WHERE "repo_id" IN (${ids})`;
    await db.$executeRaw`DELETE FROM "repo" WHERE "github_repo_id" IN (${ids})`;
    return removed;
  }
}
