import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AcquireCutoverLeaseInput,
  CutoverLeaseToken,
} from '../collection-cutover.types';
import type { RegisteredGithubIdSet } from '../collection-incremental.types';

@Injectable()
export class CollectionCutoverRepository {
  constructor(private readonly db: PrismaService) {}

  async acquireLease(
    input: AcquireCutoverLeaseInput,
  ): Promise<CutoverLeaseToken | null> {
    const rows = await this.db.$queryRawUnsafe<CutoverLeaseToken[]>(
      `INSERT INTO "CollectionCutoverLease" ("appId", "scope", "epoch", "ownerId", "expiresAt", "runId", "updatedAt")
       VALUES ($1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT ("appId", "scope") DO UPDATE SET
         "epoch" = "CollectionCutoverLease"."epoch" + 1, "ownerId" = EXCLUDED."ownerId",
         "expiresAt" = EXCLUDED."expiresAt", "runId" = EXCLUDED."runId", "updatedAt" = EXCLUDED."updatedAt"
       WHERE "CollectionCutoverLease"."expiresAt" <= $6
       RETURNING "appId", "scope", "ownerId", "epoch", "runId", "expiresAt"`,
      input.appId,
      input.scope,
      input.ownerId,
      input.expiresAt,
      input.runId,
      input.now,
    );
    return rows[0] ?? null;
  }

  async releaseLease(token: CutoverLeaseToken, now: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE "CollectionCutoverLease" SET "expiresAt" = $6, "updatedAt" = $6
       WHERE "appId" = $1 AND "scope" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
  }

  async isQuiesced(now: Date): Promise<boolean> {
    const rows = await this.db.$queryRawUnsafe<Array<{ quiesced: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM "CollectionCutoverLease" WHERE "expiresAt" > $1) AS "quiesced"`,
      now,
    );
    return rows[0]?.quiesced ?? false;
  }

  async countVerifyingStreams(): Promise<number> {
    return this.db.collectionRepositoryStream.count({
      where: { status: 'VERIFYING' },
    });
  }

  async countCommitFactsForRepositories(
    repositoryIds: readonly string[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<number> {
    if (repositoryIds.length === 0 || registeredGithubIds.size === 0) return 0;
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "CollectionCommitFact" f
      WHERE f."repositoryId" = ANY(${[...repositoryIds]})
        AND f."authorGithubId" = ANY(${[...registeredGithubIds]})
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async countPullRequestFactsForRepositories(
    repositoryIds: readonly string[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<number> {
    if (repositoryIds.length === 0 || registeredGithubIds.size === 0) return 0;
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "CollectionPullRequestFact" f
      WHERE f."repositoryId" = ANY(${[...repositoryIds]})
        AND f."authorGithubId" = ANY(${[...registeredGithubIds]})
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async countReleaseFactsForRepositories(
    repositoryIds: readonly string[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<number> {
    if (repositoryIds.length === 0 || registeredGithubIds.size === 0) return 0;
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "CollectionReleaseFact" f
      WHERE f."repositoryId" = ANY(${[...repositoryIds]})
        AND f."authorGithubId" = ANY(${[...registeredGithubIds]})
    `;
    return Number(rows[0]?.count ?? 0n);
  }
}
