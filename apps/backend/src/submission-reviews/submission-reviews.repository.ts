import { Injectable } from '@nestjs/common';
import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import type { Prisma as PrismaTypes, ReviewDecision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requiredMilestonesApproved } from '../common/milestone-completion';
import type {
  RepositoryPublishEligibility,
  SubmissionReviewContext,
  SubmissionReviewTarget,
} from './domain/submission-review';
import { LegacySubmissionPublicIdCollisionError } from '../submissions/legacy-submission-target';
import {
  TARGET_REVIEW_CONTEXT_SELECT,
  toTargetReviewContext,
} from './target-submission-review-context.mapper';

export interface CreateReviewRecordInput {
  readonly submissionRevisionId: string;
  readonly milestoneDocumentSubmissionId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export interface TransitionSubmissionInput {
  readonly submissionId: string;
  readonly expectedRevision: number;
  readonly nextStatus: SubmissionStatus;
}

export interface SubmissionReviewTransactionStore {
  findReviewTarget(
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null>;
  createReview(
    input: CreateReviewRecordInput,
  ): Promise<{ readonly id: string }>;
  transitionSubmission(input: TransitionSubmissionInput): Promise<boolean>;
}

export interface SubmissionReviewsRepositoryPort {
  withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T>;
  findReviewContext(
    submissionId: string,
  ): Promise<SubmissionReviewContext | null>;
  findPublishEligibility(
    repositoryId: string,
  ): Promise<RepositoryPublishEligibility | null>;
}

export class ReviewAlreadyExistsError extends Error {
  override readonly name = 'ReviewAlreadyExistsError';
}

class PrismaSubmissionReviewTransactionStore implements SubmissionReviewTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  async findReviewTarget(
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null> {
    const submissions =
      await this.transaction.milestoneDocumentSubmission.findMany({
        where: {
          OR: [{ id: submissionId }, { legacySubmissionId: submissionId }],
          milestoneDocument: {
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
        take: 2,
        select: { id: true },
      });
    const resolved = submissions[0];
    if (submissions.length !== 1 || resolved === undefined) return null;
    const targetId = resolved.id;
    await this.transaction.$queryRaw<readonly { id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "MilestoneDocumentSubmission"
      WHERE "id" = ${targetId}
      FOR UPDATE
    `);
    const submission =
      await this.transaction.milestoneDocumentSubmission.findUnique({
        where: { id: targetId },
        select: { id: true, revision: true, status: true },
      });
    if (submission === null) return null;
    const history =
      await this.transaction.milestoneDocumentSubmissionHistory.findFirst({
        where: {
          milestoneDocumentSubmissionId: targetId,
          revision: submission.revision,
          event: {
            in: [
              MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
              MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
            ],
          },
        },
        orderBy: { id: 'desc' },
        select: {
          id: true,
          reviewHistories: {
            where: { milestoneDocumentSubmissionId: targetId },
            take: 1,
            select: { id: true },
          },
        },
      });
    if (history === null) return null;
    return {
      id: submission.id,
      currentRevision: submission.revision,
      status: submission.status,
      revision: {
        id: history.id,
        reviewId: history.reviewHistories[0]?.id ?? null,
      },
    };
  }

  async createReview(
    input: CreateReviewRecordInput,
  ): Promise<{ readonly id: string }> {
    const review = await this.transaction.milestoneDocumentReviewHistory.create(
      {
        data: {
          milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
          submissionHistoryId: input.submissionRevisionId,
          reviewerId: input.reviewerId,
          decision: input.decision,
          comment: input.comment,
          reviewedAt: input.reviewedAt,
        },
        select: { id: true },
      },
    );
    await this.transaction.milestoneDocumentSubmissionHistory.create({
      data: {
        milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
        event: input.decision,
        revision: input.revision,
        comment: input.comment,
        actorId: input.reviewerId,
        createdAt: input.reviewedAt,
      },
      select: { id: true },
    });
    return review;
  }

  async transitionSubmission(
    input: TransitionSubmissionInput,
  ): Promise<boolean> {
    const result =
      await this.transaction.milestoneDocumentSubmission.updateMany({
        where: {
          id: input.submissionId,
          revision: input.expectedRevision,
        },
        data: { status: input.nextStatus },
      });
    return result.count === 1;
  }
}

@Injectable()
export class SubmissionReviewsRepository implements SubmissionReviewsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaSubmissionReviewTransactionStore(transaction)),
    );
  }

  async findReviewContext(
    submissionId: string,
  ): Promise<SubmissionReviewContext | null> {
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        OR: [{ id: submissionId }, { legacySubmissionId: submissionId }],
        milestoneDocument: {
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      },
      take: 2,
      select: TARGET_REVIEW_CONTEXT_SELECT,
    });
    if (submissions.length > 1) {
      throw new LegacySubmissionPublicIdCollisionError(
        'Ambiguous legacy submission public id',
      );
    }
    return submissions[0] ? toTargetReviewContext(submissions[0]) : null;
  }

  async findPublishEligibility(
    repositoryId: string,
  ): Promise<RepositoryPublishEligibility | null> {
    const repository = await this.prisma.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        visibility: true,
        application: {
          select: {
            isRepositoryPublicationPlanned: true,
            provisionJob: { select: { status: true, repositoryId: true } },
            program: {
              select: {
                endAt: true,
                milestones: {
                  select: {
                    id: true,
                    submissionType: true,
                    // ⚠ 필수 서류만 — 집합은 REVIEW_CONTEXT_SELECT 와 같아야 한다.
                    documents: {
                      where: {
                        required: true,
                        kind: MilestoneDocumentKind.DOCUMENT,
                      },
                      select: { id: true },
                    },
                  },
                },
              },
            },
            milestoneDocumentSubmissions: {
              select: {
                status: true,
                milestoneDocument: {
                  select: { id: true, milestoneId: true, kind: true },
                },
              },
            },
          },
        },
      },
    });
    // application은 #617 단계 D 이후 GithubRepository에서 nullable이지만(인벤토리 스윕이
    // 만든 행은 applicationId가 없다), 검토 대상 저장소는 항상 recordRepository가 만든
    // 행이라 application을 가진다 — null이면 잘못된 repositoryId다.
    if (repository === null || repository.application === null) return null;
    const job = repository.application.provisionJob;
    return {
      repositoryId: repository.id,
      visibility: repository.visibility,
      provisionStatus: job?.repositoryId === repository.id ? job.status : null,
      requiredMilestonesApproved: requiredMilestonesApproved(
        repository.application.program.milestones,
        repository.application.milestoneDocumentSubmissions
          .filter(
            (submission) =>
              submission.milestoneDocument.kind ===
              MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          )
          .map((submission) => ({
            milestoneId: submission.milestoneDocument.milestoneId,
            status: submission.status,
          })),
        repository.application.milestoneDocumentSubmissions
          .filter(
            (submission) =>
              submission.milestoneDocument.kind ===
              MilestoneDocumentKind.DOCUMENT,
          )
          .map((submission) => ({
            milestoneDocumentId: submission.milestoneDocument.id,
            status: submission.status,
          })),
      ),
      isRepositoryPublicationPlanned:
        repository.application.isRepositoryPublicationPlanned,
      programEndAt: repository.application.program.endAt,
    };
  }
}
