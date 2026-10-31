import {
  Prisma,
  SubmissionStatus,
  ReviewDecision,
  MilestoneSubmissionType,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';

export type DocumentDeliveryStatus =
  'MISSING' | 'LATE' | 'COMPLETE' | 'NO_REQUIRED_ITEMS';

export type MilestoneDocumentContentInput = {
  readonly text: string | null;
  readonly fileId: string | null;
};

export type MilestoneDocumentSubmittedContent = {
  readonly type: typeof MilestoneSubmissionType.TEXT;
  readonly text: string;
};

export interface CreateMilestoneDocumentReviewInput {
  readonly decision: ReviewDecision;
  readonly comment: string | null;

  readonly resubmissionDueAt: Date | null;

  readonly expectedRevision: number;

  readonly expectedLatestReviewId: string | null;
}

export interface MilestoneDocumentReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;

  readonly resubmissionDueAt: Date | null;
}

export type ProgramDocumentChangeRequestScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'TEAM'; readonly teamId: string };

export interface ProgramDocumentChangeRequestInput {
  readonly scope: ProgramDocumentChangeRequestScope;
  readonly includeFinalDecisions: boolean;
  readonly comment: string;
  readonly resubmissionDueAt: Date;
  readonly expectedVersion: string;
}

export interface ProgramDocumentChangeRequestCandidate {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly status: SubmissionStatus;
}

export interface ProgramDocumentChangeRequestPreview {
  readonly counts: Readonly<Record<SubmissionStatus, number>>;
  readonly version: string;
}

type JsonValue =
  | string
  | number
  | boolean
  | { [key: string]: JsonValue | undefined }
  | JsonValue[]
  | null;

export interface MilestoneDocumentRecord {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  graceDueAt: Date | null;
  templateFileId: string | null;
  templateFileName: string | null;
}

export interface MilestoneContext {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
}

export interface MilestoneDocumentCollectionApplication {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}

export interface MilestoneDocumentCollectionSubmission {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly file: {
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
  readonly content: JsonValue | null;
  readonly review: MilestoneDocumentReviewRecord | null;
}

export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt: Date | null;
  readonly reviewerNickname: string;
}

interface MilestoneDocumentSubmissionFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentSubmissionDetail {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly content: JsonValue | null;
  readonly submittedAt: Date;
  readonly files: readonly MilestoneDocumentSubmissionFile[];
}

export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
}

export interface DocumentDeliveryCoordinate {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
  readonly firstSubmittedAt: Date;
}

export class MilestoneDocumentCollectionReadStoreRepository {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }

  async findDocuments(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]> {
    const documents = await this.transaction.milestoneDocument.findMany({
      where: { milestoneId, kind: 'DOCUMENT' },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        sortOrder: true,
        graceDueAt: true,
        templateFile: { select: { id: true, originalFileName: true } },
      },
    });
    return documents.map(({ templateFile, ...document }) => ({
      ...document,
      templateFileId: templateFile?.id ?? null,
      templateFileName: templateFile?.originalFileName ?? null,
    }));
  }

  async findApplications(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.transaction.application.findMany({
      where: { programId, status: 'APPROVED' },
      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: {
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
      },
    });
    return applications.map((application) => ({
      applicationId: application.id,
      teamName: application.team.name,
      applicantName: application.applicant.profile?.name ?? null,
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }

  async findCoordinates(
    documentIds: readonly string[],
    applicationIds: readonly string[],
  ): Promise<readonly DocumentDeliveryCoordinate[]> {
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
          createdAt: true,
          histories: {
            where: { event: 'SUBMITTED', revision: 1 },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { createdAt: true },
          },
        },
      });
    return submissions.map((submission) => ({
      milestoneDocumentId: submission.milestoneDocumentId,
      applicationId: submission.applicationId,

      firstSubmittedAt:
        submission.histories[0]?.createdAt ?? submission.createdAt,
    }));
  }

  async findDetails(
    documentIds: readonly string[],
    applicationIds: readonly string[],
    now: Date,
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
            where: { lifecycle: 'ATTACHED', expiresAt: { gt: now } },
            orderBy: [
              {
                submissionHistory: {
                  revision: { sort: 'desc', nulls: 'last' },
                },
              },
              { createdAt: 'desc' },
            ],
            take: 1,
            select: {
              originalFileName: true,
              sizeBytes: true,
              submissionHistory: { select: { revision: true } },
            },
          },
          reviewHistories: {
            ...MilestoneDocumentCollectionReadRepository.boundedReviewHistoryQuery,
            take: 1,
          },
        },
      });
    return submissions.map(({ files, reviewHistories, ...submission }) => {
      const selectedFile = files[0];
      const review = reviewHistories[0];
      return {
        ...submission,
        file:
          selectedFile?.submissionHistory?.revision === submission.revision
            ? {
                originalFileName: selectedFile.originalFileName,
                sizeBytes: selectedFile.sizeBytes,
              }
            : null,
        review:
          review === undefined
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
export class MilestoneDocumentCollectionReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  withSnapshot<T>(
    operation: (
      store: MilestoneDocumentCollectionReadStoreRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (transaction) =>
        operation(
          new MilestoneDocumentCollectionReadStoreRepository(transaction),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  static readonly milestoneDocumentHistoryDescendingOrderBy = [
    { createdAt: 'desc' },
    { id: 'desc' },
  ] satisfies Prisma.MilestoneDocumentSubmissionHistoryOrderByWithRelationInput[];

  static readonly boundedReviewHistoryQuery = {
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      decision: true,
      comment: true,
      reviewedAt: true,

      resubmissionDueAt: true,
      reviewer: { select: { nickname: true } },
      submissionHistory: { select: { revision: true } },
    },
  } satisfies Prisma.MilestoneDocumentSubmission$reviewHistoriesArgs;
}
