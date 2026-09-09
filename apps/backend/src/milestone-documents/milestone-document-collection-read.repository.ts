import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import { boundedReviewHistoryQuery } from './milestone-document-history';
import type {
  MilestoneContext,
  MilestoneDocumentRecord,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
} from './milestone-documents.repository';

export interface DocumentDeliveryCoordinate {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
  readonly firstSubmittedAt: Date;
}

export class MilestoneDocumentCollectionReadStore {
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
      applicantName: resolveUserProfileName(application.applicant),
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
      // 이관 행에 최초 이력이 없으면 보존된 최초 행 생성 시각만 사용한다.
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
    operation: (store: MilestoneDocumentCollectionReadStore) => Promise<T>,
  ): Promise<T> {
    // 필터·전체 집계·페이지의 현재 내용은 동시 재제출 중에도 한 시점을 가리켜야 한다.
    return this.prisma.$transaction(
      (transaction) =>
        operation(new MilestoneDocumentCollectionReadStore(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
