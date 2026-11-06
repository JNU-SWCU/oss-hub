import {
  SubmissionStatus,
  FileLifecycle,
  RepositoryVisibility,
} from '@prisma/client';
import {
  SubmissionCompletionTargetRow,
  SubmissionCompletionProjections,
} from './submission-completion.config';
import {
  MilestoneCompletionStatus,
  MILESTONE_NOT_SUBMITTED,
  MilestoneCompletionInput,
} from './milestone-completion.config';
import { Injectable, Inject } from '@nestjs/common';
import { FileMetadataRepository } from './files.repository';
import { SUBMISSION_REVIEW_EVENTS } from './submission-history.config';
import {
  type RepositoryPublishEligibility,
  type PublishBlockedReason,
} from '../github/repository-publish.config';
import {
  SubmissionRevisionInvariantError,
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
  REQUIREMENTS_ERROR_CODES,
  RequirementsErrorCode,
} from './submissions.error';
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
  SubmissionsRepository,
  type SubmissionReviewDecision,
} from './submissions.repository';
import { DomainException } from '../platform/error-code.error';
import { GithubOperationsError } from '../github/github-app.error';
import { RepositoryPublishStateError } from '../github/repository-publish-state.error';
import { RepositoriesService } from '../github/repositories.service';
import { RepositoryNotFoundError } from '../github/repositories.error';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { SubmissionFileAdmissionService } from './files.service';
import {
  type CreateRequirementReviewInput,
  type CreatedRequirementReview,
  RequirementsRepository,
} from './requirements.repository';
@Injectable()
export class MilestoneCompletionService {
  collectAxisStatuses(
    input: MilestoneCompletionInput,
  ): readonly MilestoneCompletionStatus[] {
    const statuses: MilestoneCompletionStatus[] =
      input.requiredDocumentStatuses.map(
        (status) => status ?? MILESTONE_NOT_SUBMITTED,
      );
    if (isSubmissionAxisInUse(input)) {
      statuses.push(input.submissionStatus ?? MILESTONE_NOT_SUBMITTED);
    }
    return statuses;
  }
  milestoneCompletionStatus(
    input: MilestoneCompletionInput,
  ): MilestoneCompletionStatus {
    const statuses = this.collectAxisStatuses(input);
    if (statuses.length === 0) return MILESTONE_NOT_SUBMITTED;
    let worst: MilestoneCompletionStatus = SubmissionStatus.APPROVED;
    let worstRank = STATUS_PRECEDENCE.indexOf(worst);
    for (const status of statuses) {
      const rank = STATUS_PRECEDENCE.indexOf(status);
      if (rank < worstRank) {
        worst = status;
        worstRank = rank;
      }
    }
    return worst;
  }
  isMilestoneComplete(input: MilestoneCompletionInput): boolean {
    return this.milestoneCompletionStatus(input) === SubmissionStatus.APPROVED;
  }
  requiredMilestonesApproved(
    milestones: readonly {
      readonly id: string;
      readonly requirements: readonly {
        readonly id: string;
      }[];
    }[],
    submissions: readonly {
      readonly milestoneId: string;
      readonly status: SubmissionStatus;
    }[],
    documentSubmissions: readonly {
      readonly requirementId: string;
      readonly status: SubmissionStatus;
    }[],
  ): boolean {
    const statusByDocument = new Map(
      documentSubmissions.map((submission) => [
        submission.requirementId,
        submission.status,
      ]),
    );
    return milestones.every(
      (milestone) =>
        milestone.requirements.length === 0 ||
        this.isMilestoneComplete({
          submissionAxisInUse: false,
          requiredDocumentStatuses: milestone.requirements.map(
            (document) => statusByDocument.get(document.id) ?? null,
          ),
          submissionStatus: null,
        }),
    );
  }
  projectSubmissionCompletionTargets(
    targetRows: readonly SubmissionCompletionTargetRow[],
  ): SubmissionCompletionProjections {
    const submissions: {
      milestoneId: string;
      status: SubmissionStatus;
    }[] = [];
    const documentSubmissions: {
      requirementId: string;
      status: SubmissionStatus;
    }[] = [];
    for (const targetRow of targetRows) {
      documentSubmissions.push({
        requirementId: targetRow.requirement.id,
        status: targetRow.status,
      });
    }
    return { submissions, documentSubmissions };
  }
}
const STATUS_PRECEDENCE: readonly MilestoneCompletionStatus[] = [
  SubmissionStatus.REJECTED,
  SubmissionStatus.CHANGES_REQUESTED,
  MILESTONE_NOT_SUBMITTED,
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.APPROVED,
];
function isSubmissionAxisInUse(input: MilestoneCompletionInput): boolean {
  if (input.submissionAxisInUse === false) return false;
  return (
    input.requiredDocumentStatuses.length === 0 ||
    input.submissionStatus !== null
  );
}
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
export class SubmissionsService {
  constructor(
    @Inject(SubmissionReviewsRepository)
    private readonly repository: SubmissionReviewsRepositoryPort,
    @Inject(RepositoriesService)
    private readonly repositories: Pick<RepositoriesService, 'publish'>,
    private readonly repositoryPublishService: RepositoryPublishService,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly milestoneCompletionService: MilestoneCompletionService,
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  reviewInputFromRequest(request: {
    readonly revision: number;
    readonly decision: SubmissionReviewDecision;
    readonly comment?: string;
  }): CreateSubmissionReviewInput {
    return {
      revision: request.revision,
      decision: request.decision,
      comment: request.comment?.trim() || null,
    };
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
    const revisions = row.histories.filter(
      (history) =>
        history.event === 'SUBMITTED' || history.event === 'RESUBMITTED',
    );
    const current = revisions.find(
      (history) => history.revision === row.revision,
    );
    if (current === undefined) {
      throw new SubmissionRevisionInvariantError();
    }
    const repository = row.team.repository;
    const blockedReasons = repository
      ? this.repositoryPublishService.publishBlockedReasons(
          this.toPublishEligibility(row.team, repository),
          now,
        )
      : [];
    return {
      requirementId: row.requirement.id,
      latestReviewId:
        row.histories
          .filter((history) =>
            SUBMISSION_REVIEW_EVENTS.some(
              (decision) => decision === history.event,
            ),
          )
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime() ||
              right.id.localeCompare(left.id),
          )[0]?.id ?? null,
      submissionId: row.id,
      application: {
        id: row.team.id,
        applicationMode: APPLICATION_MODES.TEAM,
        displayName:
          row.team.name ??
          row.team.applicant.name ??
          row.team.applicant.nickname,
      },
      milestone: row.requirement.milestone,
      currentRevision: this.toRevisionRecord(current, row.histories, now),
      history: revisions
        .filter((history) => history.id !== current.id)
        .map((history) => this.toRevisionRecord(history, row.histories, now)),
      unversionedReviews: row.histories
        .filter(
          (history) =>
            history.revision === null &&
            SUBMISSION_REVIEW_EVENTS.some(
              (decision) => decision === history.event,
            ),
        )
        .map((history) => ({
          id: history.id,
          decision: submissionReviewDecision(history.event),
          comment: history.comment,
          reviewedAt: history.createdAt,
        })),
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
        application.submissions,
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
    request: Parameters<SubmissionsService['reviewInputFromRequest']>[0],
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
        submissionId: target.id,
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
    request: {
      readonly isConfirmed: boolean;
    },
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
    events: ReviewContextRow['histories'],
    now: Date,
  ): SubmissionRevisionRecord {
    if (history.revision === null) {
      throw new SubmissionRevisionInvariantError();
    }
    const review = events.find(
      (event) =>
        event.revision === history.revision &&
        SUBMISSION_REVIEW_EVENTS.some((decision) => decision === event.event),
    );
    return {
      number: history.revision,
      content: history.content,
      comment: history.comment,
      submittedAt: history.createdAt,
      files: history.files.flatMap((file) => this.toFileRecord(file, now)),
      review:
        review === undefined
          ? null
          : {
              id: review.id,
              decision: submissionReviewDecision(review.event),
              comment: review.comment,
              reviewedAt: review.createdAt,
            },
    };
  }
  private toFileRecord(
    file: ReviewContextRow['histories'][number]['files'][number],
    now: Date,
  ): readonly SubmissionReviewFileRecord[] {
    if (
      file.lifecycle !== FileLifecycle.ATTACHED ||
      file.expiresAt === null ||
      file.expiresAt.getTime() <= now.getTime()
    ) {
      return [];
    }
    const metadata = this.fileMetadata.read(file);
    return [
      {
        fileId: file.id,
        fileName: metadata.originalFileName,
        contentType:
          this.submissionFileAdmissionService.safeSubmissionFileContentType(
            metadata.originalFileName,
          ),
        size: metadata.sizeBytes,
        expiresAt: file.expiresAt,
        downloadUrl: `/api/v1/submission-files/${file.id}`,
      },
    ];
  }
}
function decisionStatus(decision: SubmissionReviewDecision): SubmissionStatus {
  switch (decision) {
    case 'APPROVED':
      return SubmissionStatus.APPROVED;
    case 'CHANGES_REQUESTED':
      return SubmissionStatus.CHANGES_REQUESTED;
    case 'REJECTED':
      return SubmissionStatus.REJECTED;
  }
}
function submissionReviewDecision(event: string): SubmissionReviewDecision {
  const decision = SUBMISSION_REVIEW_EVENTS.find(
    (candidate) => candidate === event,
  );
  if (decision === undefined)
    throw new TypeError('Expected a submission review event');
  return decision;
}
export interface RequirementReviewRequest {
  readonly decision: SubmissionReviewDecision;
  readonly comment?: string;
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}
@Injectable()
export class RequirementReviewsService {
  constructor(
    private readonly repository: RequirementsRepository,
    private readonly submissionRepository: SubmissionsRepository,
  ) {}
  reviewDecisionToSubmissionStatus(
    decision: SubmissionReviewDecision,
  ): SubmissionStatus {
    switch (decision) {
      case 'APPROVED':
        return SubmissionStatus.APPROVED;
      case 'CHANGES_REQUESTED':
        return SubmissionStatus.CHANGES_REQUESTED;
      case 'REJECTED':
        return SubmissionStatus.REJECTED;
    }
  }
  reviewInputFromRequest(
    request: RequirementReviewRequest,
  ): CreateRequirementReviewInput {
    return {
      decision: request.decision,
      comment: request.comment?.trim() || null,
      expectedRevision: request.expectedRevision,
      expectedLatestReviewId: request.expectedLatestReviewId,
    };
  }
  reviewFromRequest(
    reviewerId: string,
    milestoneId: string,
    documentId: string,
    teamId: string,
    request: RequirementReviewRequest,
  ): ReturnType<RequirementReviewsService['review']> {
    return this.review(
      reviewerId,
      milestoneId,
      documentId,
      teamId,
      this.reviewInputFromRequest(request),
    );
  }
  async review(
    reviewerId: string,
    milestoneId: string,
    documentId: string,
    teamId: string,
    input: CreateRequirementReviewInput,
    now: () => Date = () => new Date(),
  ): Promise<CreatedRequirementReview> {
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(RequirementsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const applicationProgramId =
      await this.repository.findApplicationProgramId(teamId);
    if (applicationProgramId !== documentContext.programId) {
      throw this.error(RequirementsErrorCode.SUBMISSION_NOT_FOUND);
    }
    const created = await this.repository.withTransaction(async (store) => {
      if (!(await store.lockProgramForReview(documentContext.programId))) {
        throw this.error(RequirementsErrorCode.PROGRAM_NOT_FOUND);
      }
      const locked = await store.lockDocument(documentId);
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(RequirementsErrorCode.DOCUMENT_NOT_FOUND);
      }
      const submission = await store.findSubmissionForReview(
        documentId,
        teamId,
      );
      if (submission === null) {
        throw this.error(RequirementsErrorCode.SUBMISSION_NOT_FOUND);
      }

      if (await store.isApplicationParticipant(teamId, reviewerId)) {
        throw this.error(RequirementsErrorCode.SELF_REVIEW_FORBIDDEN);
      }
      if (submission.revision !== input.expectedRevision) {
        throw this.error(RequirementsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const latestReviewId = await store.findLatestReviewIdForSubmission(
        submission.id,
      );
      if (latestReviewId !== input.expectedLatestReviewId) {
        throw this.error(RequirementsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const reviewedAt = this.submissionRepository.nextHistoryCreatedAt(
        now(),
        submission.latestHistoryCreatedAt,
      );
      const review = await store.createReview({
        submissionId: submission.id,
        submissionHistoryId: submission.submissionHistoryId,
        revision: submission.revision,
        reviewerId,
        decision: input.decision,
        comment: input.comment,
        reviewedAt,
      });
      await store.updateSubmissionStatus(
        submission.id,
        this.reviewDecisionToSubmissionStatus(input.decision),
      );
      return review;
    });
    return created;
  }
  private error(code: RequirementsErrorCode): DomainException {
    return new DomainException(REQUIREMENTS_ERROR_CODES[code]);
  }
}
