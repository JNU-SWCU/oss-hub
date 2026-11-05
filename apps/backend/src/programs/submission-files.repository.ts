import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, SubmissionFileLifecycle } from '@prisma/client';
import { STUDENT_MEMBER_WHERE } from '../platform/user-profile-read.config';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
} from './submission-file.error';
const MAX_DELETE_ATTEMPTS = 6;
const MAX_RETAINED_FILE_COUNT = 100;
const MAX_RETAINED_FILE_BYTES = 500 * 1024 * 1024;
export interface CreatePendingSubmissionFileInput {
  readonly uploaderId: string;
  readonly teamId: string;
  readonly milestoneId: string;
  readonly milestoneDocumentId?: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly pendingExpiresAt: Date;
  readonly resolveExpiresAt: (programEndAt: Date) => Date;
}
export interface ClaimedSubmissionFile {
  readonly id: string;
  readonly storageKey: string;
  readonly deleteAttemptCount: number;
  readonly claimOwner: string;
}
export interface DownloadableSubmissionFile {
  readonly id: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date;
}
export interface SubmissionFileCleanupOperator {
  readonly githubId: bigint;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
}
export interface ExhaustedSubmissionFileCleanup {
  readonly id: string;
  readonly deleteAttemptCount: number;
  readonly lastDeleteError: string | null;
  readonly createdAt: Date;
}
export interface RecordSubmissionFileDeleteFailureInput {
  readonly id: string;
  readonly claimOwner: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date | null;
  readonly error: 'STORAGE_DELETE_FAILED';
}
@Injectable()
export class SubmissionFilesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async findActiveStudentByGithubId(githubId: bigint): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
    return user?.id ?? null;
  }
  async findActiveAdminByGithubId(githubId: bigint): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    return user?.accountStatus === AccountStatus.ACTIVE && user.admin !== null;
  }
  async findCleanupOperator(
    operatorId: string,
  ): Promise<SubmissionFileCleanupOperator | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: {
        githubId: true,
        admin: { select: { userId: true } },
        accountStatus: true,
      },
    });
    return user === null
      ? null
      : {
          githubId: user.githubId,
          hasAdminAccess: user.admin !== null,
          accountStatus: user.accountStatus,
        };
  }
  findExhaustedCleanups(): Promise<ExhaustedSubmissionFileCleanup[]> {
    return this.prisma.submissionFile.findMany({
      where: {
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        deleteAttemptCount: { gte: MAX_DELETE_ATTEMPTS },
      },
      select: {
        id: true,
        deleteAttemptCount: true,
        lastDeleteError: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async findDownloadableFile(
    githubId: bigint,
    fileId: string,
    now: Date,
  ): Promise<DownloadableSubmissionFile | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) return null;
    if (
      user.type === 'STAFF' &&
      user.approvalStatus === 'APPROVED' &&
      user.profileCreatedAt !== null &&
      user.name !== null &&
      user.department !== null
    ) {
      return this.findAuthorizedDownloadableFile({
        ...downloadableFileWhere(fileId, now),
      });
    }
    return this.findAuthorizedDownloadableFile({
      ...downloadableFileWhere(fileId, now),
      team: {
        is: this.platformRepository.programApplicationParticipantWhere(user.id),
      },
    });
  }
  createPending(input: CreatePendingSubmissionFileInput) {
    return this.prisma.$transaction(async (transaction) => {
      const stillMember =
        await this.platformRepository.lockSubmissionMembership(
          transaction,
          input.teamId,
          input.uploaderId,
        );
      if (!stillMember) {
        throw new SubmissionMembershipChangedError(
          input.teamId,
          input.uploaderId,
        );
      }
      const programs = await transaction.$queryRaw<
        readonly {
          endAt: Date;
        }[]
      >(Prisma.sql`
        SELECT program."endAt"
        FROM "Program" AS program
        INNER JOIN "Team" AS application
          ON application."programId" = program."id"
        WHERE application."id" = ${input.teamId}
        FOR UPDATE OF program
      `);
      const program = programs[0];
      if (!program) {
        throw new SubmissionFileRetentionUnavailableError();
      }
      await transaction.$queryRaw<
        readonly {
          id: string;
        }[]
      >(Prisma.sql`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${input.uploaderId}
        FOR UPDATE
      `);
      const retained = await transaction.submissionFile.aggregate({
        where: {
          uploaderId: input.uploaderId,
          lifecycle: { not: SubmissionFileLifecycle.DELETED },
        },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      });
      if (
        retained._count._all >= MAX_RETAINED_FILE_COUNT ||
        (retained._sum.sizeBytes ?? 0) + input.sizeBytes >
          MAX_RETAINED_FILE_BYTES
      ) {
        throw new SubmissionFileQuotaExceededError();
      }
      return transaction.submissionFile.create({
        data: {
          uploaderId: input.uploaderId,
          teamId: input.teamId,
          milestoneId: input.milestoneId,
          milestoneDocumentId: input.milestoneDocumentId,
          storageKey: input.storageKey,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          lifecycle: SubmissionFileLifecycle.PENDING,
          pendingExpiresAt: input.pendingExpiresAt,
          expiresAt: input.resolveExpiresAt(program.endAt),
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
  private async findAuthorizedDownloadableFile(
    where: Prisma.SubmissionFileWhereInput,
  ): Promise<DownloadableSubmissionFile | null> {
    const file = await this.prisma.submissionFile.findFirst({
      where,
      select: {
        id: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
        expiresAt: true,
      },
    });
    if (file?.expiresAt === null || file === null) return null;
    return { ...file, expiresAt: file.expiresAt };
  }
}
function downloadableFileWhere(
  fileId: string,
  now: Date,
): Prisma.SubmissionFileWhereInput {
  return {
    id: fileId,
    lifecycle: SubmissionFileLifecycle.ATTACHED,
    milestoneDocumentSubmissionHistoryId: { not: null },
    expiresAt: { gt: now },
  };
}
