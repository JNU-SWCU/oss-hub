import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  Role,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
import { PrismaService } from '../prisma/prisma.service';
import { submissionParticipantWhere } from './submission-application.record';

const MAX_DELETE_ATTEMPTS = 6;

export interface SubmissionFileUploadAuthorization {
  readonly uploaderId: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly applicationApproved: boolean;
  readonly submissionType: MilestoneSubmissionType;
  readonly dueAt: Date;
  readonly programEndAt: Date | null;
}

export interface CreatePendingSubmissionFileInput {
  readonly uploaderId: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly pendingExpiresAt: Date;
}

export interface ClaimedSubmissionFile {
  readonly id: string;
  readonly storageKey: string;
  readonly deleteAttemptCount: number;
  readonly claimOwner: string;
}

export interface RecordSubmissionFileDeleteFailureInput {
  readonly id: string;
  readonly claimOwner: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date | null;
  readonly error: 'STORAGE_DELETE_FAILED';
}

export class SubmissionFileRetentionUnavailableError extends Error {
  override readonly name = 'SubmissionFileRetentionUnavailableError';
}

@Injectable()
export class SubmissionFilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveStudentByGithubId(githubId: bigint): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async findUploadAuthorization(
    uploaderId: string,
    applicationId: string,
    milestoneId: string,
  ): Promise<SubmissionFileUploadAuthorization | null> {
    const application = await this.prisma.application.findFirst({
      where: {
        id: applicationId,
        ...submissionParticipantWhere(uploaderId),
        program: { milestones: { some: { id: milestoneId } } },
      },
      select: {
        id: true,
        status: true,
        program: { select: { endAt: true } },
        programId: true,
      },
    });
    if (application === null) return null;

    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, programId: application.programId },
      select: { id: true, submissionType: true, dueAt: true },
    });
    if (milestone === null) return null;

    return {
      uploaderId,
      applicationId: application.id,
      milestoneId: milestone.id,
      applicationApproved: application.status === ApplicationStatus.APPROVED,
      submissionType: milestone.submissionType,
      dueAt: milestone.dueAt,
      programEndAt: application.program.endAt,
    };
  }

  createPending(input: CreatePendingSubmissionFileInput) {
    return this.prisma.$transaction(async (transaction) => {
      const programs = await transaction.$queryRaw<
        readonly { endAt: Date | null }[]
      >(Prisma.sql`
        SELECT program."endAt"
        FROM "Program" AS program
        INNER JOIN "Application" AS application
          ON application."programId" = program."id"
        WHERE application."id" = ${input.applicationId}
        FOR UPDATE OF program
      `);
      const programEndAt = programs[0]?.endAt;
      if (programEndAt == null) {
        throw new SubmissionFileRetentionUnavailableError();
      }

      return transaction.submissionFile.create({
        data: {
          uploaderId: input.uploaderId,
          applicationId: input.applicationId,
          milestoneId: input.milestoneId,
          storageKey: input.storageKey,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          lifecycle: SubmissionFileLifecycle.PENDING,
          pendingExpiresAt: input.pendingExpiresAt,
          expiresAt: addOneCalendarYear(programEndAt),
        },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          expiresAt: true,
        },
      });
    });
  }
  async claimNextForDeletion(input: {
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<ClaimedSubmissionFile | null> {
    const claimOwner = randomUUID();
    const rows = await this.prisma.$queryRaw<
      ClaimedSubmissionFile[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "SubmissionFile"
        WHERE "deleteAttemptCount" < ${MAX_DELETE_ATTEMPTS}
          AND ("deleteClaimExpiresAt" IS NULL OR "deleteClaimExpiresAt" <= ${input.now})
          AND (
            ("lifecycle" = 'PENDING' AND "pendingExpiresAt" <= ${input.now})
            OR ("lifecycle" = 'ATTACHED' AND "expiresAt" <= ${input.now})
            OR (
              "lifecycle" = 'DELETE_PENDING'
              AND (
                ("deleteClaimExpiresAt" IS NOT NULL AND "deleteClaimExpiresAt" <= ${input.now})
                OR (
                  "deleteClaimExpiresAt" IS NULL
                  AND "nextDeleteAttemptAt" IS NOT NULL
                  AND "nextDeleteAttemptAt" <= ${input.now}
                )
              )
            )
          )
        ORDER BY COALESCE("nextDeleteAttemptAt", "pendingExpiresAt", "expiresAt"), "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "SubmissionFile" AS file
      SET "lifecycle" = 'DELETE_PENDING',
          "deleteClaimedAt" = ${input.now},
          "deleteClaimExpiresAt" = ${input.leaseExpiresAt},
          "deleteClaimOwner" = ${claimOwner}
      FROM candidate
      WHERE file."id" = candidate."id"
      RETURNING file."id", file."storageKey", file."deleteAttemptCount",
                file."deleteClaimOwner" AS "claimOwner"
    `);
    return rows[0] ?? null;
  }

  async markDeleted(
    id: string,
    claimOwner: string,
    deletedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.submissionFile.updateMany({
      where: {
        id,
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        deleteClaimOwner: claimOwner,
      },
      data: {
        lifecycle: SubmissionFileLifecycle.DELETED,
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
    input: RecordSubmissionFileDeleteFailureInput,
  ): Promise<boolean> {
    const result = await this.prisma.submissionFile.updateMany({
      where: {
        id: input.id,
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        deleteClaimOwner: input.claimOwner,
        deleteAttemptCount: input.attemptCount - 1,
      },
      data: {
        deleteAttemptCount: input.attemptCount,
        nextDeleteAttemptAt: input.nextAttemptAt,
        lastDeleteError: input.error,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
      },
    });
    return result.count === 1;
  }

  async resetDeleteAttempts(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.submissionFile.updateMany({
      where: {
        id,
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        deleteAttemptCount: MAX_DELETE_ATTEMPTS,
      },
      data: {
        deleteAttemptCount: 0,
        nextDeleteAttemptAt: now,
        lastDeleteError: null,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
      },
    });
    return result.count === 1;
  }
}
