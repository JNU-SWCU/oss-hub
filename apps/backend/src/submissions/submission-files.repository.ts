import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
import { STUDENT_MEMBER_WHERE } from '../profiles/user-profile-read';
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
  readonly programEndAt: Date;
  readonly resubmissionStatus: SubmissionStatus | null;
  readonly currentRevision: number | null;
}

export interface SubmissionFileResubmissionContext {
  readonly submissionId: string;
  readonly baseRevision: number;
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

export interface DownloadableSubmissionFile {
  readonly id: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date;
}

/**
 * 재시도를 소진해 멈춘 정리 대상의 운영자 조회 행(#545).
 * 파일명·저장소 키·업로더는 담지 않는다 — 운영자에게 필요한 것은 CLI가 받는 opaque id뿐이다.
 */
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
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async findActiveAdminByGithubId(githubId: bigint): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { hasStaffAccess: true, hasAdminAccess: true, accountStatus: true },
    });
    return (
      user?.hasAdminAccess === true && user.accountStatus === AccountStatus.ACTIVE
    );
  }

  /**
   * 재시도를 소진해 `nextDeleteAttemptAt = null`로 멈춘 DELETE_PENDING 행만 돌려준다(#545).
   * `claimNextForDeletion`이 `deleteAttemptCount < MAX_DELETE_ATTEMPTS`만 집으므로
   * 여기 걸리는 행은 스케줄러가 다시 집지 않는다 — 운영자 수동 재시도 없이는 영구히 멈춘다.
   * select는 opaque id·시도 횟수·redacted 오류·생성 시각으로 고정한다.
   */
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
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) return null;

    // 교직원·관리자는 모든 파일을 받을 수 있다. 그 밖에는 자기가 참여한 제출물만이다.
    if (user.hasStaffAccess || user.hasAdminAccess) {
      return this.findAuthorizedDownloadableFile({
        ...downloadableFileWhere(fileId, now),
      });
    }
    return this.findAuthorizedDownloadableFile({
      ...downloadableFileWhere(fileId, now),
      OR: [
        { uploaderId: user.id },
        { submissionRevision: { submittedById: user.id } },
        { application: { is: submissionParticipantWhere(user.id) } },
      ],
    });
  }

  async findUploadAuthorization(
    uploaderId: string,
    applicationId: string,
    milestoneId: string,
    resubmissionContext: SubmissionFileResubmissionContext | null = null,
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

    let resubmissionStatus: SubmissionStatus | null = null;
    let currentRevision: number | null = null;
    if (resubmissionContext !== null) {
      const submission = await this.prisma.submission.findFirst({
        where: {
          id: resubmissionContext.submissionId,
          applicationId: application.id,
          milestoneId: milestone.id,
        },
        select: { status: true, currentRevision: true },
      });
      if (submission === null) return null;
      resubmissionStatus = submission.status;
      currentRevision = submission.currentRevision;
    }

    return {
      uploaderId,
      applicationId: application.id,
      milestoneId: milestone.id,
      applicationApproved: application.status === ApplicationStatus.APPROVED,
      submissionType: milestone.submissionType,
      dueAt: milestone.dueAt,
      programEndAt: application.program.endAt,
      resubmissionStatus,
      currentRevision,
    };
  }

  createPending(input: CreatePendingSubmissionFileInput) {
    return this.prisma.$transaction(async (transaction) => {
      const programs = await transaction.$queryRaw<
        readonly { endAt: Date }[]
      >(Prisma.sql`
        SELECT program."endAt"
        FROM "Program" AS program
        INNER JOIN "Application" AS application
          ON application."programId" = program."id"
        WHERE application."id" = ${input.applicationId}
        FOR UPDATE OF program
      `);
      const program = programs[0];
      if (!program) {
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
          expiresAt: addOneCalendarYear(program.endAt),
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
    submissionRevisionId: { not: null },
    expiresAt: { gt: now },
  };
}
