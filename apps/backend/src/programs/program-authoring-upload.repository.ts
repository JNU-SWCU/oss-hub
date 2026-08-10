import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, ProgramAuthoringUploadLifecycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_DELETE_ATTEMPTS = 6;
const MAX_CLAIM_BATCH_SIZE = 100;

export interface CreatePendingProgramAuthoringUploadInput {
  readonly actorId: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly expiresAt: Date;
}

export interface CreatedProgramAuthoringUpload {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date;
}

export type ProgramAuthoringUploadDeleteRequestResult =
  | { readonly kind: 'QUEUED' }
  | { readonly kind: 'IDEMPOTENT' }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'ATTACHED' };

export interface ClaimedProgramAuthoringUpload {
  readonly id: string;
  readonly storageKey: string;
  readonly deleteAttemptCount: number;
  readonly claimOwner: string;
}

export interface ClaimProgramAuthoringUploadsInput {
  readonly now: Date;
  readonly leaseExpiresAt: Date;
  readonly limit: number;
}

export interface RecordProgramAuthoringUploadDeleteFailureInput {
  readonly id: string;
  readonly claimOwner: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date;
  readonly errorCode: 'STORAGE_DELETE_FAILED';
}

@Injectable()
export class ProgramAuthoringUploadRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPending(
    input: CreatePendingProgramAuthoringUploadInput,
  ): Promise<CreatedProgramAuthoringUpload> {
    return this.prisma.programAuthoringUpload.create({
      data: {
        actorId: input.actorId,
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        expiresAt: input.expiresAt,
      },
      select: {
        id: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
        expiresAt: true,
      },
    });
  }

  async requestDelete(
    actorId: string,
    id: string,
    requestedAt: Date,
  ): Promise<ProgramAuthoringUploadDeleteRequestResult> {
    const transitioned = await this.prisma.programAuthoringUpload.updateMany({
      where: {
        id,
        actorId,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
      },
      data: {
        lifecycle: ProgramAuthoringUploadLifecycle.DELETE_PENDING,
        nextDeleteAttemptAt: requestedAt,
      },
    });
    if (transitioned.count === 1) return { kind: 'QUEUED' };

    const upload = await this.prisma.programAuthoringUpload.findFirst({
      where: { id, actorId },
      select: { lifecycle: true },
    });
    if (upload === null) return { kind: 'NOT_FOUND' };

    switch (upload.lifecycle) {
      case ProgramAuthoringUploadLifecycle.PENDING:
        return { kind: 'NOT_FOUND' };
      case ProgramAuthoringUploadLifecycle.ATTACHED:
        return { kind: 'ATTACHED' };
      case ProgramAuthoringUploadLifecycle.DELETE_PENDING:
      case ProgramAuthoringUploadLifecycle.DELETED:
        return { kind: 'IDEMPOTENT' };
    }
  }

  async claimForDeletion(
    input: ClaimProgramAuthoringUploadsInput,
  ): Promise<readonly ClaimedProgramAuthoringUpload[]> {
    const limit = Math.min(
      Math.max(Math.trunc(input.limit), 1),
      MAX_CLAIM_BATCH_SIZE,
    );
    const claimOwner = randomUUID();
    return this.prisma.$queryRaw<readonly ClaimedProgramAuthoringUpload[]>(
      Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "ProgramAuthoringUpload"
          WHERE "deleteAttemptCount" < ${MAX_DELETE_ATTEMPTS}
            AND ("deleteClaimExpiresAt" IS NULL OR "deleteClaimExpiresAt" <= ${input.now})
            AND (
              ("lifecycle" = 'PENDING' AND "expiresAt" <= ${input.now})
              OR (
                "lifecycle" = 'DELETE_PENDING'
                AND (
                  ("deleteClaimExpiresAt" IS NOT NULL AND "deleteClaimExpiresAt" <= ${input.now})
                  OR (
                    "deleteClaimExpiresAt" IS NULL
                    AND "nextDeleteAttemptAt" <= ${input.now}
                  )
                )
              )
            )
          ORDER BY COALESCE("nextDeleteAttemptAt", "expiresAt"), "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "ProgramAuthoringUpload" AS upload
        SET "lifecycle" = 'DELETE_PENDING',
            "deleteClaimedAt" = ${input.now},
            "deleteClaimExpiresAt" = ${input.leaseExpiresAt},
            "deleteClaimOwner" = ${claimOwner},
            "nextDeleteAttemptAt" = COALESCE(upload."nextDeleteAttemptAt", ${input.now}),
            "updatedAt" = ${input.now}
        FROM candidates
        WHERE upload."id" = candidates."id"
        RETURNING upload."id", upload."storageKey", upload."deleteAttemptCount",
                  upload."deleteClaimOwner" AS "claimOwner"
      `,
    );
  }

  async markDeleted(
    id: string,
    claimOwner: string,
    deletedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.programAuthoringUpload.updateMany({
      where: {
        id,
        lifecycle: ProgramAuthoringUploadLifecycle.DELETE_PENDING,
        deleteClaimOwner: claimOwner,
      },
      data: {
        lifecycle: ProgramAuthoringUploadLifecycle.DELETED,
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
    input: RecordProgramAuthoringUploadDeleteFailureInput,
  ): Promise<boolean> {
    const result = await this.prisma.programAuthoringUpload.updateMany({
      where: {
        id: input.id,
        lifecycle: ProgramAuthoringUploadLifecycle.DELETE_PENDING,
        deleteClaimOwner: input.claimOwner,
        deleteAttemptCount: input.attemptCount - 1,
      },
      data: {
        deleteAttemptCount: input.attemptCount,
        nextDeleteAttemptAt: input.nextAttemptAt,
        lastDeleteError: input.errorCode,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
      },
    });
    return result.count === 1;
  }
}
