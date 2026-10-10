import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  type ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';

import {
  lockProgramTree,
  type MilestoneLock,
} from '../../prisma/lock-program-tree';
import { PrismaService } from '../../prisma/prisma.service';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../../prisma/user-profile-read';

import { programApplicationParticipantWhere } from '../../prisma/program-application-participant';
import type { MilestoneDocumentReviewRecord } from '../domain/milestone-document-review';
import type {
  MilestoneDocumentRecord,
  MilestoneContext,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
  CreatedMilestoneDocumentReview,
  MilestoneDocumentSubmissionDetail,
} from '../domain/milestone-document-record';
import {
  boundedReviewHistoryQuery,
  milestoneDocumentHistoryDescendingOrderBy,
  reviewDecisionToHistoryEvent,
} from '../milestone-document-history';
import {
  upsertMilestoneDocumentSubmission,
  type UpsertMilestoneDocumentSubmissionInput,
} from '../milestone-document-submission.repository';
export {
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentMissingError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentSubmissionChangedError,
} from '../milestone-document-submission.repository';

export class InvalidMilestoneDocumentHistoryCursorError extends Error {
  override readonly name = 'InvalidMilestoneDocumentHistoryCursorError';
}

export interface MilestoneDocumentViewer {
  readonly id: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export interface MilestoneDocumentContext {
  readonly id: string;
  readonly milestoneId: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly required: boolean;
}

export interface StudentApplicationContext {
  readonly applicationId: string;
  readonly approved: boolean;
  readonly programEndAt: Date;
}

export interface MilestoneDocumentSubmissionSummary {
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly hasCurrentFile: boolean;

  readonly currentFileName: string | null;
  readonly historyComplete: boolean;

  readonly review: MilestoneDocumentReviewRecord | null;
}

export interface MilestoneDocumentSubmissionCoordinate {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
}

export interface MilestoneDocumentCollectionHistoryRecord {
  readonly event: MilestoneDocumentSubmissionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: Date;
  readonly fileName: string | null;

  readonly downloadableFileId: string | null;
  readonly content: Prisma.JsonValue | null;
}

export interface MilestoneDocumentHistoryPage {
  readonly items: readonly (MilestoneDocumentCollectionHistoryRecord & {
    readonly id: string;
  })[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}

export interface MilestoneDocumentArchiveSubmissionRecord {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  readonly content: Prisma.JsonValue | null;
  readonly hasCurrentFileEvidence: boolean;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}

export interface CreateMilestoneDocumentReviewInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly submissionHistoryId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;

  readonly resubmissionDueAt: Date | null;
  readonly reviewedAt: Date;
}

export interface LatestMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;

  readonly resubmissionDueAt: Date | null;
}

export interface StaffDownloadableMilestoneDocumentFile {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly teamName: string;
}

export interface MilestoneDocumentTemplateInput {
  readonly milestoneDocumentId: string;
  readonly uploadedById: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

export interface DownloadableMilestoneDocumentTemplate {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface UpdateMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
}

export interface LockedMilestone {
  readonly id: string;
}

export interface LockedMilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
}

export interface MilestoneDocumentWriteStore {
  lockMilestone(milestoneId: string): Promise<LockedMilestone | null>;

  lockDocument(documentId: string): Promise<LockedMilestoneDocument | null>;

  upsertTemplateFile(input: MilestoneDocumentTemplateInput): Promise<void>;

  lockDocumentIdsOfMilestone(milestoneId: string): Promise<readonly string[]>;
  countSubmissionsForDocument(documentId: string): Promise<number>;

  createDocument(
    milestoneId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord>;

  updateDocument(
    documentId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord>;

  applyDocumentOrder(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]>;
  deleteDocument(documentId: string): Promise<void>;

  findSubmissionForReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
    readonly latestHistoryCreatedAt: Date | null;
  } | null>;

  findLatestReviewIdForSubmission(submissionId: string): Promise<string | null>;

  createReview(
    input: CreateMilestoneDocumentReviewInput,
  ): Promise<CreatedMilestoneDocumentReview>;

  updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<void>;
}

export interface MilestoneDocumentCollectionReadStore {
  findMilestone(milestoneId: string): Promise<MilestoneContext | null>;
  findByMilestoneId(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]>;
  findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]>;
  findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]>;
  findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    applicationIds: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]>;
}

const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;

const documentRecordSelect = {
  id: true,
  milestoneId: true,
  name: true,
  required: true,
  sortOrder: true,
  templateFile: { select: { id: true, originalFileName: true } },
} as const;

function toDocumentRecord(row: {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  templateFile: { id: string; originalFileName: string } | null;
}): MilestoneDocumentRecord {
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    name: row.name,
    required: row.required,
    sortOrder: row.sortOrder,
    templateFileId: row.templateFile?.id ?? null,
    templateFileName: row.templateFile?.originalFileName ?? null,
  };
}

const collectionApplicationSelect = {
  id: true,
  applicant: { select: USER_PROFILE_NAME_SELECT },
  team: {
    select: {
      name: true,
      members: {
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { nickname: true } } },
      },
    },
  },
} as const;

function unexpiredAttachedFileWhere(now: Date) {
  return {
    lifecycle: SubmissionFileLifecycle.ATTACHED,
    expiresAt: { gt: now },
  } as const;
}

function isDownloadableSubmissionFile(
  file: {
    readonly lifecycle: SubmissionFileLifecycle;
    readonly expiresAt: Date | null;
  } | null,
  now: Date,
): boolean {
  return (
    file !== null &&
    file.lifecycle === SubmissionFileLifecycle.ATTACHED &&
    file.expiresAt !== null &&
    file.expiresAt.getTime() > now.getTime()
  );
}

const currentRevisionFileOrderBy: Prisma.SubmissionFileOrderByWithRelationInput[] =
  [
    {
      submissionHistory: {
        revision: { sort: 'desc', nulls: 'last' },
      },
    },
    { createdAt: 'desc' },
  ];

function countSubmissionsForDocumentWith(
  client: Prisma.TransactionClient,
  documentId: string,
): Promise<number> {
  return client.milestoneDocumentSubmission.count({
    where: { milestoneDocumentId: documentId },
  });
}

class PrismaMilestoneDocumentWriteStore implements MilestoneDocumentWriteStore {
  private milestoneLock: MilestoneLock | null = null;
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async lockMilestone(milestoneId: string): Promise<LockedMilestone | null> {
    this.milestoneLock = await lockProgramTree(this.transaction, {
      stage: 'milestone',
      milestoneId,
    });
    return this.milestoneLock === null ? null : { id: this.milestoneLock.id };
  }

  async lockDocument(
    documentId: string,
  ): Promise<LockedMilestoneDocument | null> {
    const rows = await this.transaction.$queryRaw<
      readonly LockedMilestoneDocument[]
    >(Prisma.sql`
      SELECT "id", "milestoneId"
      FROM "MilestoneDocument"
      WHERE "id" = ${documentId}
        AND "kind" = 'DOCUMENT'
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  async upsertTemplateFile(
    input: MilestoneDocumentTemplateInput,
  ): Promise<void> {
    await this.transaction.milestoneDocumentTemplateFile.upsert({
      where: { milestoneDocumentId: input.milestoneDocumentId },
      update: {
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: input.uploadedById,
        uploadedAt: input.uploadedAt,
      },
      create: {
        milestoneDocumentId: input.milestoneDocumentId,
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: input.uploadedById,
        uploadedAt: input.uploadedAt,
      },
    });
  }

  async lockDocumentIdsOfMilestone(
    milestoneId: string,
  ): Promise<readonly string[]> {
    if (this.milestoneLock === null || this.milestoneLock.id !== milestoneId) {
      throw new Error('Milestone must be locked before its documents.');
    }
    const result = await lockProgramTree(this.transaction, {
      stage: 'documents',
      after: this.milestoneLock,
      documentKind: 'DOCUMENT',
    });
    return result.documentIds;
  }

  countSubmissionsForDocument(documentId: string): Promise<number> {
    return countSubmissionsForDocumentWith(this.transaction, documentId);
  }

  async createDocument(
    milestoneId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const last = await this.transaction.milestoneDocument.aggregate({
      where: { milestoneId, kind: MilestoneDocumentKind.DOCUMENT },
      _max: { sortOrder: true },
    });
    const sortOrder = (last._max.sortOrder ?? 0) + 1;
    const created = await this.transaction.milestoneDocument.create({
      data: {
        milestoneId,
        ...input,
        sortOrder,
        kind: MilestoneDocumentKind.DOCUMENT,
      },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        sortOrder: true,
      },
    });
    return {
      ...created,
      templateFileId: null,
      templateFileName: null,
    };
  }

  async updateDocument(
    documentId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const updated = await this.transaction.milestoneDocument.update({
      where: { id: documentId, kind: MilestoneDocumentKind.DOCUMENT },
      data: input,
      select: documentRecordSelect,
    });
    return toDocumentRecord(updated);
  }

  async applyDocumentOrder(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]> {
    for (const [index, documentId] of documentIds.entries()) {
      await this.transaction.milestoneDocument.update({
        where: {
          id: documentId,
          milestoneId,
          kind: MilestoneDocumentKind.DOCUMENT,
        },
        data: { sortOrder: index + 1 },
        select: { id: true },
      });
    }
    const documents = await this.transaction.milestoneDocument.findMany({
      where: { milestoneId, kind: MilestoneDocumentKind.DOCUMENT },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.transaction.milestoneDocumentTemplateFile.deleteMany({
      where: { milestoneDocumentId: documentId },
    });
    await this.transaction.milestoneDocument.delete({
      where: { id: documentId, kind: MilestoneDocumentKind.DOCUMENT },
    });
  }

  findSubmissionForReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
    readonly latestHistoryCreatedAt: Date | null;
  } | null> {
    return this.findSubmissionForReviewWithHistory(
      milestoneDocumentId,
      applicationId,
    );
  }

  private async findSubmissionForReviewWithHistory(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
    readonly latestHistoryCreatedAt: Date | null;
  } | null> {
    const submission =
      await this.transaction.milestoneDocumentSubmission.findUnique({
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          id: true,
          revision: true,
          histories: {
            where: {
              event: {
                in: [
                  MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
                  MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
                ],
              },
            },
            orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true, revision: true },
          },
        },
      });
    const history = submission?.histories[0];
    if (
      submission === null ||
      history === undefined ||
      history.revision !== submission.revision
    ) {
      return null;
    }
    const latestHistory =
      await this.transaction.milestoneDocumentSubmissionHistory.findFirst({
        where: { milestoneDocumentSubmissionId: submission.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
    return {
      id: submission.id,
      revision: submission.revision,
      submissionHistoryId: history.id,
      latestHistoryCreatedAt: latestHistory?.createdAt ?? null,
    };
  }

  async findLatestReviewIdForSubmission(
    submissionId: string,
  ): Promise<string | null> {
    const review =
      await this.transaction.milestoneDocumentReviewHistory.findFirst({
        where: { milestoneDocumentSubmissionId: submissionId },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
    return review?.id ?? null;
  }

  async createReview(
    input: CreateMilestoneDocumentReviewInput,
  ): Promise<CreatedMilestoneDocumentReview> {
    await this.transaction.milestoneDocumentSubmissionHistory.create({
      data: {
        milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
        event: reviewDecisionToHistoryEvent(input.decision),
        revision: input.revision,
        actorId: input.reviewerId,
        comment: input.comment,
        createdAt: input.reviewedAt,
      },
      select: { id: true },
    });
    const created =
      await this.transaction.milestoneDocumentReviewHistory.create({
        data: {
          milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
          submissionHistoryId: input.submissionHistoryId,
          reviewerId: input.reviewerId,
          decision: input.decision,
          comment: input.comment,
          resubmissionDueAt: input.resubmissionDueAt,
          reviewedAt: input.reviewedAt,
        },
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewedAt: true,
          resubmissionDueAt: true,
          reviewer: { select: { nickname: true } },
        },
      });
    return {
      id: created.id,
      decision: created.decision,
      comment: created.comment,
      reviewedAt: created.reviewedAt,
      resubmissionDueAt: created.resubmissionDueAt,
      reviewerNickname: created.reviewer.nickname,
    };
  }

  async updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<void> {
    await this.transaction.milestoneDocumentSubmission.update({
      where: { id: submissionId },
      data: { status },
      select: { id: true },
    });
  }
}

class PrismaMilestoneDocumentCollectionReadStore implements MilestoneDocumentCollectionReadStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }

  async findByMilestoneId(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]> {
    const documents = await this.transaction.milestoneDocument.findMany({
      where: { milestoneId, kind: MilestoneDocumentKind.DOCUMENT },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }

  async findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.transaction.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: collectionApplicationSelect,
    });
    return applications.map((application) => ({
      applicationId: application.id,
      teamName: application.team.name,
      applicantName: resolveUserProfileName(application.applicant),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }

  async findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]> {
    if (documentIds.length === 0) return [];
    return this.transaction.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: { milestoneDocumentId: true, applicationId: true },
    });
  }

  async findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    applicationIds: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || applicationIds.length === 0) return [];
    const submissions =
      await this.transaction.milestoneDocumentSubmission.findMany({
        where: {
          milestoneDocumentId: { in: [...documentIds] },
          applicationId: { in: [...applicationIds] },
        },
        select: {
          milestoneDocumentId: true,
          applicationId: true,
          submittedAt: true,
          revision: true,
          status: true,
          content: true,
          files: {
            where: unexpiredAttachedFileWhere(now),
            orderBy: currentRevisionFileOrderBy,
            take: 1,
            select: {
              originalFileName: true,
              sizeBytes: true,
              submissionHistory: { select: { revision: true } },
            },
          },
          reviewHistories: {
            ...boundedReviewHistoryQuery,
            take: 1,
          },
        },
      });
    return submissions.map((submission) => {
      const review = submission.reviewHistories[0] ?? null;
      const selectedFile = submission.files[0];
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        applicationId: submission.applicationId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        content: submission.content,
        file,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: review.decision,
                comment: review.comment,
                reviewedAt: review.reviewedAt,
                resubmissionDueAt: review.resubmissionDueAt,
              },
      };
    });
  }
}

@Injectable()
export class MilestoneDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: MilestoneDocumentWriteStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaMilestoneDocumentWriteStore(transaction)),
    );
  }

  withCollectionSnapshot<T>(
    operation: (store: MilestoneDocumentCollectionReadStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (transaction) =>
        operation(new PrismaMilestoneDocumentCollectionReadStore(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findByMilestoneId(
    milestoneId: string,
  ): Promise<MilestoneDocumentRecord[]> {
    const documents = await this.prisma.milestoneDocument.findMany({
      where: { milestoneId, kind: MilestoneDocumentKind.DOCUMENT },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }

  async findActiveUser(
    githubId: bigint,
  ): Promise<MilestoneDocumentViewer | null> {
    return this.prisma.user.findFirst({
      where: { githubId, accountStatus: AccountStatus.ACTIVE },
      select: { id: true, hasStaffAccess: true, hasAdminAccess: true },
    });
  }

  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<{ readonly id: string } | null> {
    return this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
  }

  async findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }

  async findDocumentContext(
    documentId: string,
  ): Promise<MilestoneDocumentContext | null> {
    const document = await this.prisma.milestoneDocument.findFirst({
      where: { id: documentId, kind: MilestoneDocumentKind.DOCUMENT },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        milestone: { select: { programId: true, dueAt: true } },
      },
    });
    if (document === null) return null;
    return {
      id: document.id,
      milestoneId: document.milestoneId,
      programId: document.milestone.programId,
      name: document.name,
      dueAt: document.milestone.dueAt,
      required: document.required,
    };
  }

  async findStudentApplication(
    userId: string,
    programId: string,
  ): Promise<StudentApplicationContext | null> {
    const application = await this.prisma.application.findFirst({
      where: { programId, ...programApplicationParticipantWhere(userId) },
      select: {
        id: true,
        status: true,
        program: { select: { endAt: true } },
      },
    });
    if (application === null) return null;
    return {
      applicationId: application.id,
      approved: application.status === ApplicationStatus.APPROVED,
      programEndAt: application.program.endAt,
    };
  }

  async findSubmittedSummaries(
    applicationId: string,
    documentIds: readonly string[],
    now: Date = new Date(),
  ): Promise<readonly MilestoneDocumentSubmissionSummary[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        applicationId,
        milestoneDocumentId: { in: [...documentIds] },
      },
      select: {
        milestoneDocumentId: true,
        submittedAt: true,
        revision: true,
        status: true,
        _count: {
          select: {
            histories: {
              where: {
                event: {
                  in: [
                    MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
                    MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
                  ],
                },
              },
            },
          },
        },
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            originalFileName: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        reviewHistories: {
          ...boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.reviewHistories[0] ?? null;

      const currentFile =
        submission.files[0]?.submissionHistory?.revision === submission.revision
          ? (submission.files[0] ?? null)
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        hasCurrentFile: currentFile !== null,
        currentFileName: currentFile?.originalFileName ?? null,
        historyComplete: submission._count.histories === submission.revision,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: review.decision,
                comment: review.comment,
                reviewedAt: review.reviewedAt,
                resubmissionDueAt: review.resubmissionDueAt,
              },
      };
    });
  }

  async findLatestReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<LatestMilestoneDocumentReview | null> {
    const review = await this.prisma.milestoneDocumentReviewHistory.findFirst({
      where: {
        milestoneDocumentSubmission: { milestoneDocumentId, applicationId },
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, decision: true, resubmissionDueAt: true },
    });
    return review;
  }

  async findSubmissionHistoryPage(
    milestoneDocumentId: string,
    applicationId: string,
    cursor: string | null,
    limit: number,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentHistoryPage | null> {
    const submission = await this.prisma.milestoneDocumentSubmission.findUnique(
      {
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          id: true,
          revision: true,
          _count: {
            select: {
              histories: {
                where: {
                  event: {
                    in: [
                      MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
                      MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
                    ],
                  },
                },
              },
            },
          },
        },
      },
    );
    if (submission === null) return null;
    if (cursor !== null) {
      const scopedCursor =
        await this.prisma.milestoneDocumentSubmissionHistory.findFirst({
          where: {
            id: cursor,
            milestoneDocumentSubmissionId: submission.id,
          },
          select: { id: true },
        });
      if (scopedCursor === null) {
        throw new InvalidMilestoneDocumentHistoryCursorError();
      }
    }
    const rows = await this.prisma.milestoneDocumentSubmissionHistory.findMany({
      where: { milestoneDocumentSubmissionId: submission.id },
      orderBy: milestoneDocumentHistoryDescendingOrderBy,
      take: limit + 1,
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        event: true,
        revision: true,
        comment: true,
        content: true,
        createdAt: true,
        actor: { select: { nickname: true } },
        files: {
          orderBy: { createdAt: 'desc' },
          take: 1,

          select: {
            id: true,
            originalFileName: true,
            lifecycle: true,
            expiresAt: true,
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const nextCursor = hasMore ? (visible.at(-1)?.id ?? null) : null;
    return {
      items: visible.toReversed().map((row) => {
        const file = row.files[0] ?? null;
        return {
          id: row.id,
          event: row.event,
          revision: row.revision,
          actorNickname: row.actor.nickname,
          comment: row.comment,
          createdAt: row.createdAt,
          fileName: file?.originalFileName ?? null,
          downloadableFileId: isDownloadableSubmissionFile(file, now)
            ? (file?.id ?? null)
            : null,
          content: row.content,
        };
      }),
      nextCursor,
      isComplete: submission._count.histories === submission.revision,
    };
  }

  async countApprovedApplications(programId: string): Promise<number> {
    return this.prisma.application.count({
      where: { programId, status: ApplicationStatus.APPROVED },
    });
  }

  async countSubmissionsByDocument(
    programId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (documentIds.length === 0) return new Map();
    const grouped = await this.prisma.milestoneDocumentSubmission.groupBy({
      by: ['milestoneDocumentId'],
      where: {
        milestoneDocumentId: { in: [...documentIds] },
        application: { programId, status: ApplicationStatus.APPROVED },
      },
      _count: { _all: true },
    });
    return new Map(
      grouped.map((row) => [row.milestoneDocumentId, row._count._all]),
    );
  }

  async findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },

      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: collectionApplicationSelect,
    });
    return applications.map((application) => ({
      applicationId: application.id,
      teamName: application.team.name,
      applicantName: resolveUserProfileName(application.applicant),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }

  async findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]> {
    if (documentIds.length === 0) return [];
    return this.prisma.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: { milestoneDocumentId: true, applicationId: true },
    });
  }

  async findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    applicationIds?: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || applicationIds?.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        milestoneDocumentId: { in: [...documentIds] },
        ...(applicationIds === undefined
          ? {}
          : { applicationId: { in: [...applicationIds] } }),
      },
      select: {
        milestoneDocumentId: true,
        applicationId: true,
        submittedAt: true,

        revision: true,
        status: true,
        content: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            originalFileName: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        reviewHistories: {
          ...boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.reviewHistories[0] ?? null;
      const selectedFile = submission.files[0];
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        applicationId: submission.applicationId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        content: submission.content,
        file,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: review.decision,
                comment: review.comment,
                reviewedAt: review.reviewedAt,
                resubmissionDueAt: review.resubmissionDueAt,
              },
      };
    });
  }

  async findSubmissionsForArchive(
    documentIds: readonly string[],
    now: Date,
  ): Promise<readonly MilestoneDocumentArchiveSubmissionRecord[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: {
        milestoneDocumentId: true,
        applicationId: true,
        submittedAt: true,
        revision: true,
        status: true,
        content: true,
        files: {
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            storageKey: true,
            originalFileName: true,
            sizeBytes: true,
            lifecycle: true,
            expiresAt: true,
            submissionHistory: { select: { revision: true } },
          },
        },
      },
    });
    return submissions.map((submission) => {
      const selectedFile = submission.files[0];
      const hasCurrentFileEvidence =
        selectedFile !== undefined &&
        selectedFile.submissionHistory?.revision === submission.revision;
      const file =
        selectedFile !== undefined &&
        hasCurrentFileEvidence &&
        selectedFile.lifecycle === SubmissionFileLifecycle.ATTACHED &&
        selectedFile.expiresAt !== null &&
        selectedFile.expiresAt > now
          ? {
              storageKey: selectedFile.storageKey,
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        applicationId: submission.applicationId,
        submittedAt: submission.submittedAt,
        status: submission.status,
        content: submission.content,
        hasCurrentFileEvidence,
        file,
      };
    });
  }

  async findApplicationProgramId(
    applicationId: string,
  ): Promise<string | null> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { programId: true },
    });
    return application?.programId ?? null;
  }

  async findSubmissionFileForStaffDownload(
    milestoneDocumentId: string,
    applicationId: string,
    now: Date,
  ): Promise<StaffDownloadableMilestoneDocumentFile | null> {
    const submission = await this.prisma.milestoneDocumentSubmission.findUnique(
      {
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          application: { select: { team: { select: { name: true } } } },
          revision: true,
          files: {
            where: unexpiredAttachedFileWhere(now),
            orderBy: currentRevisionFileOrderBy,
            take: 1,
            select: {
              storageKey: true,
              originalFileName: true,
              mimeType: true,
              sizeBytes: true,
              submissionHistory: { select: { revision: true } },
            },
          },
        },
      },
    );
    const file = submission?.files[0];
    if (
      submission == null ||
      file == null ||
      file.submissionHistory?.revision !== submission.revision
    ) {
      return null;
    }
    return {
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      teamName: submission.application.team.name,
    };
  }

  async findTemplateForDownload(
    documentId: string,
  ): Promise<DownloadableMilestoneDocumentTemplate | null> {
    return this.prisma.milestoneDocumentTemplateFile.findFirst({
      where: {
        milestoneDocumentId: documentId,
        milestoneDocument: { kind: MilestoneDocumentKind.DOCUMENT },
      },
      select: {
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
  }

  async upsertSubmission(
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return upsertMilestoneDocumentSubmission(this.prisma, input);
  }

  async findMySubmission(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<MilestoneDocumentSubmissionDetail | null> {
    const submission = await this.prisma.milestoneDocumentSubmission.findUnique(
      {
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          id: true,
          status: true,
          content: true,
          submittedAt: true,
          revision: true,
          files: {
            where: { lifecycle: SubmissionFileLifecycle.ATTACHED },
            orderBy: currentRevisionFileOrderBy,
            take: 1,
            select: {
              ...attachedFileSelect,
              submissionHistory: { select: { revision: true } },
            },
          },
        },
      },
    );
    if (submission === null) return null;
    const file = submission.files[0];
    return {
      id: submission.id,
      status: submission.status,
      content: submission.content,
      submittedAt: submission.submittedAt,
      files:
        file?.submissionHistory?.revision === submission.revision
          ? [
              {
                id: file.id,
                originalFileName: file.originalFileName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
              },
            ]
          : [],
    };
  }
}
