import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AcquireCanonicalLeaseInput,
  CanonicalCommitSnapshotRow,
  CanonicalFailureStatus,
  CanonicalGenerationInventory,
  CanonicalGenerationSnapshot,
  CanonicalLeaseKey,
  CanonicalLeaseToken,
  CanonicalPullRequestRow,
  CanonicalReleaseRow,
  CanonicalRepositoryRow,
  CanonicalStatusSnapshot,
} from './collection-canonical.types';

type SqlValue = string | number | bigint | boolean | Date | null;
interface RawClient {
  $executeRawUnsafe(sql: string, ...values: SqlValue[]): Promise<number>;
  $queryRawUnsafe<T>(sql: string, ...values: SqlValue[]): Promise<T>;
}

const assertChanged = (count: number, message: string): void => {
  if (count !== 1) throw new Error(message);
};

@Injectable()
export class CollectionCanonicalRepository {
  constructor(private readonly db: PrismaService) {}
  async appendPreflightFailure(
    input: CanonicalLeaseKey & {
      runId: string;
      failedAt: Date;
      errorClass: string;
      validity?: {
        installationValid: boolean;
        permissionsValid: boolean;
      };
    },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "CanonicalCollectionRun" ("id", "appId", "organizationLogin", "status", "errorClass", "finishedAt") VALUES ($1, $2, $3, 'FAILED', $4, $5)`,
        input.runId,
        input.appId,
        input.organizationLogin,
        input.errorClass,
        input.failedAt,
      );
      if (!input.validity) return;
      await tx.$executeRawUnsafe(
        `INSERT INTO "CanonicalOrganizationState" ("appId", "organizationLogin", "installationValid", "permissionsValid", "installationCheckedAt", "permissionsCheckedAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $5, $5)
         ON CONFLICT ("appId", "organizationLogin") DO UPDATE SET
           "installationValid" = EXCLUDED."installationValid", "permissionsValid" = EXCLUDED."permissionsValid",
           "installationCheckedAt" = EXCLUDED."installationCheckedAt", "permissionsCheckedAt" = EXCLUDED."permissionsCheckedAt", "updatedAt" = EXCLUDED."updatedAt"
         WHERE ("CanonicalOrganizationState"."installationCheckedAt" IS NULL OR "CanonicalOrganizationState"."installationCheckedAt" <= EXCLUDED."installationCheckedAt")
           AND ("CanonicalOrganizationState"."permissionsCheckedAt" IS NULL OR "CanonicalOrganizationState"."permissionsCheckedAt" <= EXCLUDED."permissionsCheckedAt")`,
        input.appId,
        input.organizationLogin,
        input.validity.installationValid,
        input.validity.permissionsValid,
        input.failedAt,
      );
    });
  }

  async createCandidate(
    input: CanonicalLeaseKey & {
      runId: string;
      checkedAt: Date;
    },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "CanonicalCollectionRun" ("id", "appId", "organizationLogin", "status") VALUES ($1, $2, $3, 'PENDING')`,
        input.runId,
        input.appId,
        input.organizationLogin,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "CanonicalOrganizationState" ("appId", "organizationLogin", "installationValid", "permissionsValid", "updatedAt")
         VALUES ($1, $2, false, false, $3)
         ON CONFLICT ("appId", "organizationLogin") DO NOTHING`,
        input.appId,
        input.organizationLogin,
        input.checkedAt,
      );
    });
  }
  async markValidity(
    token: CanonicalLeaseToken,
    now: Date,
    validity: { installationValid: boolean; permissionsValid: boolean },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.assertLease(tx, token, now);
      await this.setValidity(tx, token, now, validity);
    });
  }

  async acquireLease(
    input: AcquireCanonicalLeaseInput,
  ): Promise<CanonicalLeaseToken | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<CanonicalLeaseToken[]>(
        `INSERT INTO "CanonicalCollectionLease" ("appId", "organizationLogin", "epoch", "ownerId", "expiresAt", "runId", "updatedAt")
         SELECT $1, $2, 1, $3, $4, $5, $6
         WHERE EXISTS (SELECT 1 FROM "CanonicalCollectionRun" WHERE "id" = $5 AND "appId" = $1 AND "organizationLogin" = $2 AND "status" = 'PENDING')
         ON CONFLICT ("appId", "organizationLogin") DO UPDATE SET
           "epoch" = "CanonicalCollectionLease"."epoch" + 1, "ownerId" = EXCLUDED."ownerId",
           "expiresAt" = EXCLUDED."expiresAt", "runId" = EXCLUDED."runId", "updatedAt" = EXCLUDED."updatedAt"
         WHERE "CanonicalCollectionLease"."expiresAt" <= $6
         RETURNING "appId", "organizationLogin", "ownerId", "epoch", "runId", "expiresAt"`,
        input.appId,
        input.organizationLogin,
        input.ownerId,
        input.expiresAt,
        input.runId,
        input.now,
      );
      if (!rows[0]) return null;
      const started = await tx.$executeRawUnsafe(
        `UPDATE "CanonicalCollectionRun" SET "status" = 'PROCESSING', "startedAt" = $2 WHERE "id" = $1 AND "status" = 'PENDING'`,
        input.runId,
        input.now,
      );
      assertChanged(started, 'Canonical candidate is not pending');
      return rows[0];
    });
  }

  async heartbeatLease(
    token: CanonicalLeaseToken,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "CanonicalCollectionLease" SET "expiresAt" = $6, "updatedAt" = $5
       WHERE "appId" = $1 AND "organizationLogin" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "expiresAt" > $5 AND "runId" = $7`,
      token.appId,
      token.organizationLogin,
      token.ownerId,
      token.epoch,
      now,
      expiresAt,
      token.runId,
    );
    assertChanged(count, 'Canonical collection lease is stale');
  }

  async writeGeneration(
    token: CanonicalLeaseToken,
    now: Date | (() => Date),
    inventory: CanonicalGenerationInventory,
    heartbeat?: () => Promise<void>,
  ): Promise<void> {
    const currentTime = (): Date => (now instanceof Date ? now : now());
    const batchSize = 100;
    this.assertInventory(inventory);

    const transaction = async (
      write: (tx: RawClient) => Promise<void>,
    ): Promise<void> => {
      if (heartbeat) await heartbeat();
      await this.db.$transaction(async (tx) => {
        await this.assertLease(tx, token, currentTime());
        await write(tx);
      });
    };

    await transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM "CanonicalRepository" WHERE "generationId" = $1`,
        token.runId,
      );
    });

    for (
      let offset = 0;
      offset < inventory.repositories.length;
      offset += batchSize
    )
      await transaction(async (tx) => {
        for (const row of inventory.repositories.slice(
          offset,
          offset + batchSize,
        ))
          await tx.$executeRawUnsafe(
            `INSERT INTO "CanonicalRepository" ("generationId", "githubRepositoryId", "fullName", "visibility", "archived", "defaultBranch") VALUES ($1,$2,$3,$4,$5,$6)`,
            token.runId,
            row.githubRepositoryId,
            row.fullName,
            row.visibility,
            row.archived,
            row.defaultBranch,
          );
      });
    for (let offset = 0; offset < inventory.commits.length; offset += batchSize)
      await transaction(async (tx) => {
        for (const row of inventory.commits.slice(offset, offset + batchSize))
          await tx.$executeRawUnsafe(
            `INSERT INTO "CanonicalDefaultBranchCommit" ("generationId", "githubRepositoryId", "sha", "committedAt", "authorGithubId", "authorGithubLogin") VALUES ($1,$2,$3,$4,$5,$6)`,
            token.runId,
            row.githubRepositoryId,
            row.sha,
            row.committedAt,
            row.authorGithubId ?? null,
            row.authorGithubLogin ?? null,
          );
      });
    for (
      let offset = 0;
      offset < inventory.pullRequests.length;
      offset += batchSize
    )
      await transaction(async (tx) => {
        for (const row of inventory.pullRequests.slice(
          offset,
          offset + batchSize,
        ))
          await tx.$executeRawUnsafe(
            `INSERT INTO "CanonicalPullRequest" ("generationId", "githubRepositoryId", "githubPullRequestId", "state", "createdAt", "authorGithubId", "authorGithubLogin") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            token.runId,
            row.githubRepositoryId,
            row.githubPullRequestId,
            row.state,
            row.createdAt,
            row.authorGithubId,
            row.authorGithubLogin,
          );
      });
    for (
      let offset = 0;
      offset < inventory.releases.length;
      offset += batchSize
    )
      await transaction(async (tx) => {
        for (const row of inventory.releases.slice(offset, offset + batchSize))
          await tx.$executeRawUnsafe(
            `INSERT INTO "CanonicalRelease" ("generationId", "githubRepositoryId", "githubReleaseId", "publishedAt", "authorGithubId", "authorGithubLogin") VALUES ($1,$2,$3,$4,$5,$6)`,
            token.runId,
            row.githubRepositoryId,
            row.githubReleaseId,
            row.publishedAt,
            row.authorGithubId,
            row.authorGithubLogin,
          );
      });
    for (
      let offset = 0;
      offset < inventory.contributors.length;
      offset += batchSize
    )
      await transaction(async (tx) => {
        for (const row of inventory.contributors.slice(
          offset,
          offset + batchSize,
        ))
          await tx.$executeRawUnsafe(
            `INSERT INTO "CanonicalContributorProjection" ("generationId", "githubRepositoryId", "githubUserId", "githubLogin", "commitCount", "pullRequestCount", "releaseCount", "currentYear", "currentYearCommitCount", "currentYearPullRequestCount", "currentYearReleaseCount") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            token.runId,
            row.githubRepositoryId,
            row.githubUserId,
            row.githubLogin,
            row.commitCount,
            row.pullRequestCount,
            row.releaseCount,
            row.currentYear,
            row.currentYearCommitCount,
            row.currentYearPullRequestCount,
            row.currentYearReleaseCount,
          );
      });
  }

  async completeAndPublish(
    token: CanonicalLeaseToken,
    now: Date,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.assertLease(tx, token, now);
      const completed = await tx.$executeRawUnsafe(
        `UPDATE "CanonicalCollectionRun" SET "status" = 'SUCCEEDED', "finishedAt" = $2, "errorClass" = NULL WHERE "id" = $1 AND "status" = 'PROCESSING'`,
        token.runId,
        now,
      );
      assertChanged(completed, 'Canonical candidate is not publishable');
      const published = await tx.$executeRawUnsafe(
        `UPDATE "CanonicalOrganizationState" SET "activeGenerationId" = $3, "updatedAt" = $4
         WHERE "appId" = $1 AND "organizationLogin" = $2 AND "installationValid" = true AND "permissionsValid" = true`,
        token.appId,
        token.organizationLogin,
        token.runId,
        now,
      );
      assertChanged(
        published,
        'Canonical inventory is not valid for publication',
      );
      await this.releaseLease(tx, token, now);
    });
  }

  async finalizeFailure(
    token: CanonicalLeaseToken,
    now: Date,
    status: CanonicalFailureStatus,
    errorClass: string | null,
    validity?: {
      installationValid: boolean;
      permissionsValid: boolean;
    },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.assertLease(tx, token, now);
      const count = await tx.$executeRawUnsafe(
        `UPDATE "CanonicalCollectionRun" SET "status" = $2::"CanonicalCollectionRunStatus", "errorClass" = $3, "finishedAt" = $4 WHERE "id" = $1 AND "status" = 'PROCESSING'`,
        token.runId,
        status,
        errorClass,
        now,
      );
      assertChanged(count, 'Canonical candidate is not processing');
      if (validity) await this.setValidity(tx, token, now, validity);
      await this.releaseLease(tx, token, now);
    });
  }

  async getStatusSnapshot(
    key: CanonicalLeaseKey,
  ): Promise<CanonicalStatusSnapshot | null> {
    const rows = await this.db.$queryRawUnsafe<CanonicalStatusSnapshot[]>(
      `SELECT s."appId", s."organizationLogin", s."activeGenerationId", s."installationValid", s."permissionsValid",
              r."id" AS "runId", r."status" AS "runStatus", r."errorClass",
              GREATEST(s."updatedAt", COALESCE(r."finishedAt", r."startedAt", r."createdAt")) AS "updatedAt"
       FROM "CanonicalOrganizationState" s
       LEFT JOIN LATERAL (SELECT "id", "status", "errorClass", "createdAt", "startedAt", "finishedAt" FROM "CanonicalCollectionRun"
         WHERE "appId" = s."appId" AND "organizationLogin" = s."organizationLogin" ORDER BY "createdAt" DESC LIMIT 1) r ON true
       WHERE s."appId" = $1 AND s."organizationLogin" = $2`,
      key.appId,
      key.organizationLogin,
    );
    return rows[0] ?? null;
  }

  /**
   * Read-only projection of the latest published generation for (appId,
   * organizationLogin) — the source for todo 8's generation import command.
   * Returns null when no generation has ever been published (never invents
   * a synthetic generation). Contributor projections are not read here; see
   * `CanonicalGenerationSnapshot`.
   */
  async getActiveGenerationSnapshot(
    key: CanonicalLeaseKey,
  ): Promise<CanonicalGenerationSnapshot | null> {
    const state = await this.db.$queryRawUnsafe<
      Array<{ activeGenerationId: string | null }>
    >(
      `SELECT "activeGenerationId" FROM "CanonicalOrganizationState" WHERE "appId" = $1 AND "organizationLogin" = $2`,
      key.appId,
      key.organizationLogin,
    );
    const generationId = state[0]?.activeGenerationId;
    if (!generationId) return null;

    const run = await this.db.$queryRawUnsafe<
      Array<{ id: string; finishedAt: Date | null; status: string }>
    >(
      `SELECT "id", "finishedAt", "status" FROM "CanonicalCollectionRun" WHERE "id" = $1`,
      generationId,
    );
    const finishedAt = run[0]?.finishedAt;
    if (!run[0] || run[0].status !== 'SUCCEEDED' || !finishedAt) return null;

    const [repositories, commits, pullRequests, releases] = await Promise.all([
      this.db.$queryRawUnsafe<CanonicalRepositoryRow[]>(
        `SELECT "githubRepositoryId", "fullName", "visibility", "archived", "defaultBranch"
           FROM "CanonicalRepository" WHERE "generationId" = $1 ORDER BY "githubRepositoryId"`,
        generationId,
      ),
      this.db.$queryRawUnsafe<CanonicalCommitSnapshotRow[]>(
        `SELECT "githubRepositoryId", "sha", "committedAt", "authorGithubId", "authorGithubLogin"
           FROM "CanonicalDefaultBranchCommit" WHERE "generationId" = $1 ORDER BY "githubRepositoryId", "sha"`,
        generationId,
      ),
      this.db.$queryRawUnsafe<CanonicalPullRequestRow[]>(
        `SELECT "githubRepositoryId", "githubPullRequestId", "state", "createdAt", "authorGithubId", "authorGithubLogin"
           FROM "CanonicalPullRequest" WHERE "generationId" = $1 ORDER BY "githubRepositoryId", "githubPullRequestId"`,
        generationId,
      ),
      this.db.$queryRawUnsafe<CanonicalReleaseRow[]>(
        `SELECT "githubRepositoryId", "githubReleaseId", "publishedAt", "authorGithubId", "authorGithubLogin"
           FROM "CanonicalRelease" WHERE "generationId" = $1 ORDER BY "githubRepositoryId", "githubReleaseId"`,
        generationId,
      ),
    ]);

    return {
      runId: generationId,
      finishedAt,
      repositories,
      commits,
      pullRequests,
      releases,
    };
  }

  async cleanupUnpublishedCandidate(runId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const eligible = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT r."id" FROM "CanonicalCollectionRun" r WHERE r."id" = $1 AND r."status" <> 'SUCCEEDED'
         AND NOT EXISTS (SELECT 1 FROM "CanonicalOrganizationState" s WHERE s."activeGenerationId" = r."id") FOR UPDATE`,
        runId,
      );
      if (!eligible[0]) return false;
      await tx.$executeRawUnsafe(
        `DELETE FROM "CanonicalCollectionLease" WHERE "runId" = $1`,
        runId,
      );
      const count = await tx.$executeRawUnsafe(
        `DELETE FROM "CanonicalCollectionRun" WHERE "id" = $1`,
        runId,
      );
      return count === 1;
    });
  }

  private assertInventory(inventory: CanonicalGenerationInventory): void {
    const repositories = new Map(
      inventory.repositories.map((repository) => [
        repository.githubRepositoryId,
        repository,
      ]),
    );
    const resourceRepositoryIds = [
      ...inventory.commits,
      ...inventory.pullRequests,
      ...inventory.releases,
      ...inventory.contributors,
    ].map((resource) => resource.githubRepositoryId);
    if (resourceRepositoryIds.some((id) => !repositories.has(id))) {
      throw new Error('Canonical resource references an unknown repository');
    }
    if (
      inventory.commits.some(
        (commit) =>
          (commit.authorGithubId === undefined) !==
          (commit.authorGithubLogin === undefined),
      )
    ) {
      throw new Error(
        'Canonical commit author id and login must be provided together',
      );
    }
    if (
      inventory.pullRequests.some(
        (pullRequest) =>
          (pullRequest.authorGithubId === null) !==
          (pullRequest.authorGithubLogin === null),
      ) ||
      inventory.releases.some(
        (release) =>
          (release.authorGithubId === null) !==
          (release.authorGithubLogin === null),
      )
    ) {
      throw new Error(
        'Canonical resource author id and login must be provided together',
      );
    }
    if (
      inventory.contributors.some(
        (contributor) =>
          repositories
            .get(contributor.githubRepositoryId)
            ?.visibility.toLowerCase() !== 'public' ||
          contributor.commitCount < 0 ||
          contributor.pullRequestCount < 0 ||
          contributor.releaseCount < 0 ||
          contributor.currentYearCommitCount < 0 ||
          contributor.currentYearPullRequestCount < 0 ||
          contributor.currentYearReleaseCount < 0,
      )
    ) {
      throw new Error(
        'Canonical contributor projections must be public and non-negative',
      );
    }
  }
  private async setValidity(
    tx: RawClient,
    key: CanonicalLeaseKey,
    now: Date,
    validity: { installationValid: boolean; permissionsValid: boolean },
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `UPDATE "CanonicalOrganizationState"
       SET "installationValid" = $3, "permissionsValid" = $4,
           "installationCheckedAt" = $5, "permissionsCheckedAt" = $5, "updatedAt" = $5
       WHERE "appId" = $1 AND "organizationLogin" = $2
         AND ("installationCheckedAt" IS NULL OR "installationCheckedAt" <= $5)
         AND ("permissionsCheckedAt" IS NULL OR "permissionsCheckedAt" <= $5)`,
      key.appId,
      key.organizationLogin,
      validity.installationValid,
      validity.permissionsValid,
      now,
    );
  }

  private async releaseLease(
    tx: RawClient,
    token: CanonicalLeaseToken,
    now: Date,
  ): Promise<void> {
    const count = await tx.$executeRawUnsafe(
      `UPDATE "CanonicalCollectionLease"
       SET "expiresAt" = $6, "updatedAt" = $6
       WHERE "appId" = $1 AND "organizationLogin" = $2 AND "ownerId" = $3
         AND "epoch" = $4 AND "runId" = $5`,
      token.appId,
      token.organizationLogin,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
    assertChanged(count, 'Canonical collection lease is stale');
  }
  private async assertLease(
    tx: RawClient,
    token: CanonicalLeaseToken,
    now: Date,
  ): Promise<void> {
    const rows = await tx.$queryRawUnsafe<Array<{ owned: boolean }>>(
      `SELECT true AS "owned" FROM "CanonicalCollectionLease" WHERE "appId" = $1 AND "organizationLogin" = $2
       AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5 AND "expiresAt" > $6 FOR UPDATE`,
      token.appId,
      token.organizationLogin,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
    if (!rows[0]) throw new Error('Canonical collection lease is stale');
  }
}
