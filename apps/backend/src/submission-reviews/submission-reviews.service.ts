import { Inject, Injectable } from '@nestjs/common';
import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import { GithubOperationsError } from '../repositories/github-app.error';
import { RepositoryPublishStateError } from '../repositories/repositories.repository';
import {
  RepositoriesService,
  RepositoryNotFoundError,
} from '../repositories/repositories.service';
import type {
  CreateSubmissionReviewInput,
  RepositoryPublishResult,
  SubmissionReviewContext,
  SubmissionReviewResult,
} from './domain/submission-review';
import {
  ReviewAlreadyExistsError,
  SubmissionReviewsRepository,
  type SubmissionReviewsRepositoryPort,
} from './submission-reviews.repository';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.enum';

@Injectable()
export class SubmissionReviewsService {
  constructor(
    @Inject(SubmissionReviewsRepository)
    private readonly repository: SubmissionReviewsRepositoryPort,
    @Inject(RepositoriesService)
    private readonly repositories: Pick<RepositoriesService, 'publish'>,
  ) {}

  async context(submissionId: string): Promise<SubmissionReviewContext> {
    const context = await this.repository.findReviewContext(submissionId);
    if (context === null) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND
        ],
      );
    }
    return context;
  }

  async review(
    reviewerId: string,
    submissionId: string,
    input: CreateSubmissionReviewInput,
    reviewedAt = new Date(),
  ): Promise<SubmissionReviewResult> {
    try {
      return await this.repository.withTransaction(async (store) => {
        const target = await store.findReviewTarget(submissionId);
        if (target === null) {
          throw new DomainException(
            SUBMISSION_REVIEWS_ERROR_CODES[
              SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND
            ],
          );
        }
        if (target.currentRevision !== input.revision) {
          throw new DomainException(
            SUBMISSION_REVIEWS_ERROR_CODES[
              SubmissionReviewsErrorCode.STALE_REVISION
            ],
          );
        }
        if (target.revision.reviewId !== null) {
          throw new DomainException(
            SUBMISSION_REVIEWS_ERROR_CODES[
              SubmissionReviewsErrorCode.ALREADY_REVIEWED
            ],
          );
        }

        const nextStatus = decisionStatus(input.decision);
        const review = await store.createReview({
          submissionRevisionId: target.revision.id,
          reviewerId,
          decision: input.decision,
          comment: input.comment,
          reviewedAt,
        });
        const transitioned = await store.transitionSubmission({
          submissionId,
          expectedRevision: input.revision,
          nextStatus,
        });
        if (!transitioned) {
          throw new DomainException(
            SUBMISSION_REVIEWS_ERROR_CODES[
              SubmissionReviewsErrorCode.STALE_REVISION
            ],
          );
        }
        return { reviewId: review.id, submissionStatus: nextStatus };
      });
    } catch (error) {
      if (error instanceof ReviewAlreadyExistsError) {
        throw new DomainException(
          SUBMISSION_REVIEWS_ERROR_CODES[
            SubmissionReviewsErrorCode.ALREADY_REVIEWED
          ],
        );
      }
      throw error;
    }
  }

  async publishRepository(
    repositoryId: string,
    publishedAt = new Date(),
  ): Promise<RepositoryPublishResult> {
    const eligibility =
      await this.repository.findPublishEligibility(repositoryId);
    if (
      eligibility === null ||
      (eligibility.visibility === RepositoryVisibility.PRIVATE &&
        eligibility.provisionStatus !== RepositoryProvisionJobStatus.SUCCEEDED)
    ) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.REPOSITORY_NOT_READY
        ],
      );
    }
    if (
      eligibility.visibility === RepositoryVisibility.PRIVATE &&
      !eligibility.requiredMilestonesApproved
    ) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED
        ],
      );
    }

    let published: Awaited<ReturnType<RepositoriesService['publish']>>;
    try {
      published = await this.repositories.publish(
        { repositoryId },
        publishedAt,
      );
    } catch (error) {
      if (error instanceof RepositoryNotFoundError) {
        throw new DomainException(
          SUBMISSION_REVIEWS_ERROR_CODES[
            SubmissionReviewsErrorCode.REPOSITORY_NOT_READY
          ],
        );
      }
      if (
        error instanceof GithubOperationsError ||
        error instanceof RepositoryPublishStateError
      ) {
        throw new DomainException(
          SUBMISSION_REVIEWS_ERROR_CODES[
            SubmissionReviewsErrorCode.GITHUB_PUBLISH_FAILED
          ],
        );
      }
      throw error;
    }
    if (
      published.visibility !== RepositoryVisibility.PUBLIC ||
      published.publishedAt === null
    ) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.GITHUB_PUBLISH_FAILED
        ],
      );
    }
    return {
      repositoryId: published.id,
      visibility: published.visibility,
      publishedAt: published.publishedAt,
    };
  }
}

function decisionStatus(decision: ReviewDecision): SubmissionStatus {
  switch (decision) {
    case ReviewDecision.APPROVED:
      return SubmissionStatus.APPROVED;
    case ReviewDecision.CHANGES_REQUESTED:
      return SubmissionStatus.CHANGES_REQUESTED;
    case ReviewDecision.REJECTED:
      return SubmissionStatus.REJECTED;
  }
}
