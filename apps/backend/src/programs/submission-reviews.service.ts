import { Injectable, Inject } from '@nestjs/common';
import {
  SubmissionStatus,
  ReviewDecision,
  SubmissionFileLifecycle,
  RepositoryVisibility,
} from '@prisma/client';
import type {
  RepositoryPublishEligibility,
  PublishBlockedReason,
} from '../github/repository-publish.config';
import { SubmissionRevisionInvariantError } from './submission-review-context-mapper.error';
import {
  ReviewContextRow,
  SubmissionRevisionRecord,
  SubmissionReviewFileRecord,
  SubmissionReviewsRepository,
  type SubmissionReviewsRepositoryPort,
  type CreateSubmissionReviewInput,
  type RepositoryPublishResult,
  type SubmissionReviewContext,
  type SubmissionReviewResult,
  type PublishEligibilitySource,
} from './submission-reviews.repository';
import { DomainException } from '../platform/error-code.error';
import { GithubOperationsError } from '../github/github-app.error';
import { RepositoryPublishStateError } from '../github/repository-publish-state.error';
import { RepositoriesService } from '../github/repositories.service';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.error';
import { RepositoryNotFoundError } from '../github/repositories.error';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './milestone-completion.service';
import { SubmissionFileAdmissionService } from './submission-file-admission.service';

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

const APPLICATION_MODES = {
  PERSONAL: 'PERSONAL',
  TEAM: 'TEAM',
} as const;

@Injectable()
export class SubmissionReviewsService {
  constructor(
    @Inject(SubmissionReviewsRepository)
    private readonly repository: SubmissionReviewsRepositoryPort,
    @Inject(RepositoriesService)
    private readonly repositories: Pick<RepositoriesService, 'publish'>,
    private readonly repositoryPublishService: RepositoryPublishService,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly milestoneCompletionService: MilestoneCompletionService,
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
  ) {}

  reviewInputFromRequest(request: {
    readonly revision: number;
    readonly decision: ReviewDecision;
    readonly comment?: string;
  }): CreateSubmissionReviewInput {
    const comment = request.comment?.trim() || null;
    switch (request.decision) {
      case ReviewDecision.APPROVED:
        return {
          revision: request.revision,
          decision: request.decision,
          comment,
        };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED:
        if (comment === null) {
          throw new DomainException(
            SUBMISSION_REVIEWS_ERROR_CODES[
              SubmissionReviewsErrorCode.COMMENT_REQUIRED
            ],
          );
        }
        return {
          revision: request.revision,
          decision: request.decision,
          comment,
        };
    }
  }

  assertPublishConfirmed(request: { readonly isConfirmed: boolean }): void {
    if (request.isConfirmed !== true) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.PUBLISH_CONFIRMATION_REQUIRED
        ],
      );
    }
  }

  async context(submissionId: string): Promise<SubmissionReviewContext> {
    const row = await this.repository.findReviewContext(submissionId);
    if (row === null) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND
        ],
      );
    }
    return this.toReviewContext(row);
  }

  private toReviewContext(
    row: ReviewContextRow,
    now: Date = new Date(),
  ): SubmissionReviewContext {
    const current = row.histories.find(
      (history) => history.revision === row.revision,
    );
    if (current === undefined) {
      throw new SubmissionRevisionInvariantError();
    }
    const repository = row.application.repository;
    const blockedReasons = repository
      ? this.repositoryPublishService.publishBlockedReasons(
          this.toPublishEligibility(row.application, repository),
          now,
        )
      : [];
    return {
      submissionId: row.legacySubmissionId ?? row.id,
      application: {
        id: row.application.id,
        applicationMode:
          row.application.teamId === null
            ? APPLICATION_MODES.PERSONAL
            : APPLICATION_MODES.TEAM,
        displayName:
          row.application.team?.name ??
          row.application.applicant.profile?.name ??
          row.application.applicant.nickname,
      },
      milestone: row.milestoneDocument.milestone,
      currentRevision: this.toRevisionRecord(current, now),
      history: row.histories
        .filter((history) => history.id !== current.id)
        .map((history) => this.toRevisionRecord(history, now)),
      repository: repository
        ? {
            id: repository.id,
            url: this.repositoryUrlService.repositoryUrlFromNameWithOwner(
              repository.nameWithOwner,
            ),
            visibility: repository.visibility,
            publishEligible: blockedReasons.length === 0,
            blockedReasons,
          }
        : null,
    };
  }

  private toPublishEligibility(
    application: PublishEligibilitySource,
    repository: {
      readonly id: string;
      readonly visibility: RepositoryVisibility;
    },
  ): Omit<RepositoryPublishEligibility, 'repositoryId'> {
    const { submissions, documentSubmissions } =
      this.milestoneCompletionService.projectSubmissionCompletionTargets(
        application.milestoneDocumentSubmissions,
      );
    const job = application.provisionJob;
    return {
      visibility: repository.visibility,
      provisionStatus: job?.repositoryId === repository.id ? job.status : null,
      requiredMilestonesApproved:
        this.milestoneCompletionService.requiredMilestonesApproved(
          application.program.milestones,
          submissions,
          documentSubmissions,
        ),
      isRepositoryPublicationPlanned:
        application.isRepositoryPublicationPlanned,
      programEndAt: application.program.endAt,
    };
  }

  reviewFromRequest(
    reviewerId: string,
    submissionId: string,
    request: Parameters<SubmissionReviewsService['reviewInputFromRequest']>[0],
  ): Promise<SubmissionReviewResult> {
    return this.review(
      reviewerId,
      submissionId,
      this.reviewInputFromRequest(request),
    );
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
      if (await store.isSubmissionParticipant(target.id, reviewerId)) {
        throw new DomainException(
          SUBMISSION_REVIEWS_ERROR_CODES[
            SubmissionReviewsErrorCode.SELF_REVIEW_FORBIDDEN
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

  publishRepositoryFromRequest(
    repositoryId: string,
    actorGithubId: bigint,
    request: { readonly isConfirmed: boolean },
  ): Promise<RepositoryPublishResult> {
    this.assertPublishConfirmed(request);
    return this.publishRepository(repositoryId, actorGithubId);
  }

  async publishRepository(
    repositoryId: string,
    actorGithubId: bigint,
    publishedAt = new Date(),
  ): Promise<RepositoryPublishResult> {
    const eligibilityRow =
      await this.repository.findPublishEligibility(repositoryId);
    if (eligibilityRow === null) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.REPOSITORY_NOT_READY
        ],
      );
    }

    const [blockedReason] = this.repositoryPublishService.publishBlockedReasons(
      this.toPublishEligibility(eligibilityRow.application, eligibilityRow),
      publishedAt,
    );
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

  private toRevisionRecord(
    history: ReviewContextRow['histories'][number],
    now: Date,
  ): SubmissionRevisionRecord {
    if (history.revision === null) {
      throw new SubmissionRevisionInvariantError();
    }
    return {
      number: history.revision,
      content: history.content,
      comment: history.comment,
      submittedAt: history.createdAt,
      files: history.files.flatMap((file) => this.toFileRecord(file, now)),
      review: history.reviewHistories[0] ?? null,
    };
  }

  private toFileRecord(
    file: ReviewContextRow['histories'][number]['files'][number],
    now: Date,
  ): readonly SubmissionReviewFileRecord[] {
    if (
      file.lifecycle !== SubmissionFileLifecycle.ATTACHED ||
      file.expiresAt === null ||
      file.expiresAt.getTime() <= now.getTime()
    ) {
      return [];
    }
    return [
      {
        fileId: file.id,
        fileName: file.originalFileName,
        contentType:
          this.submissionFileAdmissionService.safeSubmissionFileContentType(
            file.originalFileName,
          ),
        size: file.sizeBytes,
        expiresAt: file.expiresAt,
        downloadUrl: `/api/v1/submission-files/${file.id}`,
      },
    ];
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
