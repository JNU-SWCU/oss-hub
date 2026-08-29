import { Injectable } from '@nestjs/common';
import { Prisma, SubmissionStatus } from '@prisma/client';
import type { Prisma as PrismaTypes, ReviewDecision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requiredMilestonesApproved } from '../common/milestone-completion';
import type {
  RepositoryPublishEligibility,
  SubmissionReviewContext,
  SubmissionReviewTarget,
} from './domain/submission-review';
import {
  REVIEW_CONTEXT_SELECT,
  toReviewContext,
} from './submission-review-context.mapper';

export interface CreateReviewRecordInput {
  readonly submissionRevisionId: string;
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
    const submission = await this.transaction.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, currentRevision: true, status: true },
    });
    if (submission === null) return null;
    const revision = await this.transaction.submissionRevision.findUnique({
      where: {
        submissionId_revision: {
          submissionId,
          revision: submission.currentRevision,
        },
      },
      select: { id: true, review: { select: { id: true } } },
    });
    if (revision === null) return null;
    return {
      ...submission,
      revision: { id: revision.id, reviewId: revision.review?.id ?? null },
    };
  }

  async createReview(
    input: CreateReviewRecordInput,
  ): Promise<{ readonly id: string }> {
    try {
      return await this.transaction.review.create({
        data: input,
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ReviewAlreadyExistsError();
      }
      throw error;
    }
  }

  async transitionSubmission(
    input: TransitionSubmissionInput,
  ): Promise<boolean> {
    const result = await this.transaction.submission.updateMany({
      where: {
        id: input.submissionId,
        currentRevision: input.expectedRevision,
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
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: REVIEW_CONTEXT_SELECT,
    });
    return submission ? toReviewContext(submission) : null;
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
                      where: { required: true },
                      select: { id: true },
                    },
                  },
                },
              },
            },
            submissions: { select: { milestoneId: true, status: true } },
            milestoneDocumentSubmissions: {
              select: { milestoneDocumentId: true, status: true },
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
        repository.application.submissions,
        repository.application.milestoneDocumentSubmissions,
      ),
      isRepositoryPublicationPlanned:
        repository.application.isRepositoryPublicationPlanned,
      programEndAt: repository.application.program.endAt,
    };
  }
}
