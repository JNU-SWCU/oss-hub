import { Inject, Injectable } from '@nestjs/common';
import {
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import { GithubOperationsError } from '../github/github-app.error';
import { RepositoryPublishStateError } from '../github/repository/repositories.repository';
import {
  RepositoriesService,
  RepositoryNotFoundError,
} from '../github/service/repositories.service';
import {
  publishBlockedReasons,
  type CreateSubmissionReviewInput,
  type PublishBlockedReason,
  type RepositoryPublishResult,
  type SubmissionReviewContext,
  type SubmissionReviewResult,
} from './domain/submission-review';
import {
  SubmissionReviewsRepository,
  type SubmissionReviewsRepositoryPort,
} from './submission-reviews.repository';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.enum';

/**
 * 공개 차단 사유를 교직원에게 나갈 오류 코드로 옮긴다.
 * `satisfies`가 완전성을 강제한다 — 사유가 늘면 여기에 코드를 주기 전까지 컴파일되지 않는다.
 */
const PUBLISH_BLOCKED_ERROR_CODES = {
  REPOSITORY_NOT_READY: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY,
  REPOSITORY_PUBLICATION_NOT_PLANNED:
    SubmissionReviewsErrorCode.REPOSITORY_PUBLICATION_NOT_PLANNED,
  PROGRAM_NOT_ENDED: SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED,
  REQUIRED_MILESTONES_NOT_APPROVED:
    SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED,
} as const satisfies Readonly<
  Record<PublishBlockedReason, SubmissionReviewsErrorCode>
>;

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
    return this.repository.withTransaction(async (store) => {
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
        submissionHistoryId: target.revision.id,
        milestoneDocumentSubmissionId: target.id,
        revision: input.revision,
        reviewerId,
        decision: input.decision,
        comment: input.comment,
        reviewedAt,
      });
      const transitioned = await store.transitionSubmission({
        submissionId: target.id,
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
  }

  async publishRepository(
    repositoryId: string,
    actorGithubId: bigint,
    publishedAt = new Date(),
  ): Promise<RepositoryPublishResult> {
    const eligibility =
      await this.repository.findPublishEligibility(repositoryId);
    if (eligibility === null) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.REPOSITORY_NOT_READY
        ],
      );
    }
    // 검토 화면(`toReviewContext`)과 같은 함수를 본다 — 여기서만 조건을 늘리면 화면이 다시 갈라진다.
    const [blockedReason] = publishBlockedReasons(eligibility, publishedAt);
    if (blockedReason !== undefined) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          PUBLISH_BLOCKED_ERROR_CODES[blockedReason]
        ],
      );
    }

    let published: Awaited<ReturnType<RepositoriesService['publish']>>;
    try {
      published = await this.repositories.publish(
        { repositoryId },
        actorGithubId,
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
