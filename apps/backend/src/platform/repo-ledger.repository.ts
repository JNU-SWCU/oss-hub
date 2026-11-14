import { Injectable } from '@nestjs/common';
import {
  CollectionRepositoryPresence,
  Prisma,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';

type RepoLedgerClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

type RepoWriteClient = Pick<Prisma.TransactionClient, '$executeRaw' | 'repo'>;

export interface RepoClaim {
  readonly teamId: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
  readonly source: RepositorySource;
  readonly inventory?: {
    readonly defaultBranch: string | null;
    readonly archived: boolean;
  };
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
  async claim(db: RepoWriteClient, input: RepoClaim): Promise<void> {
    const data = {
      ownerName: input.nameWithOwner,
      visibility: input.visibility,
      source: input.source,
      presence: CollectionRepositoryPresence.PRESENT,
      goneAt: null,
      ...input.inventory,
    };
    await db.repo.upsert({
      where: { githubRepoId: input.githubRepositoryId },
      create: { ...data, githubRepoId: input.githubRepositoryId },
      update: data,
    });
    await this.link(db, input.teamId, input.githubRepositoryId);
  }

  async publish(
    db: RepoWriteClient,
    githubRepositoryId: bigint,
    publishedAt: Date,
  ): Promise<boolean> {
    const updated = await db.repo.updateMany({
      where: {
        githubRepoId: githubRepositoryId,
        visibility: RepositoryVisibility.PRIVATE,
      },
      data: { visibility: RepositoryVisibility.PUBLIC, publishedAt },
    });
    return updated.count === 1;
  }

  async observe(db: RepoWriteClient, input: RepoInventory): Promise<boolean> {
    const updated = await db.repo.updateMany({
      where: { githubRepoId: input.githubRepositoryId, source: input.source },
      data: {
        ownerName: input.nameWithOwner,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: input.presence,
        goneAt:
          input.presence === CollectionRepositoryPresence.ABSENT
            ? input.observedAt
            : null,
      },
    });
    return updated.count > 0;
  }

  async link(
    db: RepoLedgerClient,
    teamId: string,
    githubRepositoryId: bigint,
  ): Promise<void> {
    await db.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      SELECT
        team."id",
        ${githubRepositoryId},
        GREATEST(
          transaction_timestamp()::timestamptz(3),
          (
            SELECT MAX(period."valid_to")
            FROM "team_repo" AS period
            WHERE period."repo_id" = ${githubRepositoryId}
              OR period."team_id" = team."id"
          )
        )
      FROM "Team" AS team
      WHERE team."id" = ${teamId}
        AND team."archivedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "team_repo" AS open_period
          WHERE open_period."repo_id" = ${githubRepositoryId}
            AND open_period."team_id" = team."id"
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
    await db.$executeRaw`DELETE FROM "contribution" WHERE "repo_id" IN (${ids})`;
    await db.$executeRaw`DELETE FROM "team_repo" WHERE "repo_id" IN (${ids})`;
    return db.$executeRaw`DELETE FROM "repo" WHERE "github_repo_id" IN (${ids})`;
  }
}
