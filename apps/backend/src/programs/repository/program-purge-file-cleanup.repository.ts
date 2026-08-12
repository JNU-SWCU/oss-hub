import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, ProgramPurgeFileTombstoneLifecycle } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_DELETE_ATTEMPTS = 6;

export type ClaimedProgramPurgeFileTombstone = {
  readonly id: string;
  readonly storageKey: string;
  readonly deleteAttemptCount: number;
  readonly claimOwner: string;
};

export interface RecordProgramPurgeFileDeleteFailureInput {
  readonly id: string;
  readonly claimOwner: string;
  readonly attemptCount: number;
  readonly nextDeleteAttemptAt: Date | null;
}

@Injectable()
export class ProgramPurgeFileCleanupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimNextForDeletion(input: {
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<ClaimedProgramPurgeFileTombstone | null> {
    const claimOwner = randomUUID();
    const rows = await this.prisma.$queryRaw<
      ClaimedProgramPurgeFileTombstone[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "ProgramPurgeFileTombstone"
        WHERE "lifecycle" = 'DELETE_PENDING'
          AND "deleteAttemptCount" < ${MAX_DELETE_ATTEMPTS}
          AND ("deleteClaimExpiresAt" IS NULL OR "deleteClaimExpiresAt" <= ${input.now})
          AND (
            ("deleteClaimExpiresAt" IS NOT NULL AND "deleteClaimExpiresAt" <= ${input.now})
            OR (
              "deleteClaimExpiresAt" IS NULL
              AND "nextDeleteAttemptAt" IS NOT NULL
              AND "nextDeleteAttemptAt" <= ${input.now}
            )
          )
        ORDER BY "nextDeleteAttemptAt", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "ProgramPurgeFileTombstone" AS tombstone
      SET "deleteClaimedAt" = ${input.now},
          "deleteClaimExpiresAt" = ${input.leaseExpiresAt},
          "deleteClaimOwner" = ${claimOwner},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE tombstone."id" = candidate."id"
      RETURNING tombstone."id", tombstone."storageKey",
                tombstone."deleteAttemptCount",
                tombstone."deleteClaimOwner" AS "claimOwner"
    `);
    return rows[0] ?? null;
  }

  async markDeleted(
    id: string,
    claimOwner: string,
    deletedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.programPurgeFileTombstone.updateMany({
      where: {
        id,
        lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETE_PENDING,
        deleteClaimOwner: claimOwner,
      },
      data: {
        lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETED,
        deletedAt,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
        nextDeleteAttemptAt: null,
        lastDeleteError: null,
      },
    });
    return result.count === 1;
  }

  async recordDeleteFailure(
    input: RecordProgramPurgeFileDeleteFailureInput,
  ): Promise<boolean> {
    const result = await this.prisma.programPurgeFileTombstone.updateMany({
      where: {
        id: input.id,
        lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETE_PENDING,
        deleteClaimOwner: input.claimOwner,
        deleteAttemptCount: input.attemptCount - 1,
      },
      data: {
        deleteAttemptCount: input.attemptCount,
        nextDeleteAttemptAt: input.nextDeleteAttemptAt,
        lastDeleteError: 'STORAGE_DELETE_FAILED',
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
      },
    });
    return result.count === 1;
  }
}
