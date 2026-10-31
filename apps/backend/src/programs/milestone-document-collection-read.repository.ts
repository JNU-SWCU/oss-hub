import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  UserProfileReadRepository,
} from '../platform/user-profile-read.repository';
import type {
  MilestoneContext,
  MilestoneDocumentRecord,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
} from './milestone-document-result.types';

export const milestoneDocumentHistoryDescendingOrderBy = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MilestoneDocumentSubmissionHistoryOrderByWithRelationInput[];

export function nextMilestoneDocumentHistoryCreatedAt(
  requested: Date,
  latest: Date | null,
): Date {
  return latest === null || requested.getTime() > latest.getTime()
    ? requested
    : new Date(latest.getTime() + 1);
}

export const boundedReviewHistoryQuery = {
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
      applicantName: UserProfileReadRepository.resolveUserProfileName(
        application.applicant,
      ),
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
          reviewHistories: { ...boundedReviewHistoryQuery, take: 1 },
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
}
