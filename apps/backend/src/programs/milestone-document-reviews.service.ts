import { Injectable } from '@nestjs/common';
import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  type CreateMilestoneDocumentReviewInput,
  type CreatedMilestoneDocumentReview,
} from './milestone-document-collection-read.repository';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentSubmissionRepository } from './milestone-document-submission.repository';

export interface MilestoneDocumentReviewRequest {
  readonly decision: ReviewDecision;
  readonly comment?: string;
  readonly resubmissionDueAt?: string;
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}

@Injectable()
export class MilestoneDocumentReviewsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    private readonly milestoneDocumentSubmissionRepository: MilestoneDocumentSubmissionRepository,
  ) {}

  reviewDecisionToSubmissionStatus(decision: ReviewDecision): SubmissionStatus {
    switch (decision) {
      case ReviewDecision.APPROVED:
        return SubmissionStatus.APPROVED;
      case ReviewDecision.CHANGES_REQUESTED:
        return SubmissionStatus.CHANGES_REQUESTED;
      case ReviewDecision.REJECTED:
        return SubmissionStatus.REJECTED;
    }
  }

  reviewInputFromRequest(
    request: MilestoneDocumentReviewRequest,
  ): CreateMilestoneDocumentReviewInput {
    const comment = request.comment?.trim() || null;
    const version = {
      expectedRevision: request.expectedRevision,
      expectedLatestReviewId: request.expectedLatestReviewId,
    };
    switch (request.decision) {
      case ReviewDecision.APPROVED:
        return {
          decision: request.decision,
          comment,
          resubmissionDueAt: null,
          ...version,
        };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED: {
        if (comment === null) {
          throw this.error(MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED);
        }
        if (request.decision === ReviewDecision.REJECTED) {
          return {
            decision: request.decision,
            comment,
            resubmissionDueAt: null,
            ...version,
          };
        }

        const resubmissionDueAt =
          request.resubmissionDueAt === undefined
            ? null
            : new Date(request.resubmissionDueAt);
        if (
          resubmissionDueAt === null ||
          Number.isNaN(resubmissionDueAt.getTime())
        ) {
          throw this.error(
            MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED,
          );
        }
        return {
          decision: request.decision,
          comment,
          resubmissionDueAt,
          ...version,
        };
      }
    }
  }

  reviewFromRequest(
    reviewerId: string,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    request: MilestoneDocumentReviewRequest,
  ): ReturnType<MilestoneDocumentReviewsService['review']> {
    return this.review(
      reviewerId,
      milestoneId,
      documentId,
      applicationId,
      this.reviewInputFromRequest(request),
    );
  }

  async review(
    reviewerId: string,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    input: CreateMilestoneDocumentReviewInput,
    now: () => Date = () => new Date(),
  ): Promise<CreatedMilestoneDocumentReview> {
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const applicationProgramId =
      await this.repository.findApplicationProgramId(applicationId);
    if (applicationProgramId !== documentContext.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
    }

    const created = await this.repository.withTransaction(async (store) => {
      const locked = await store.lockDocument(documentId);

      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }

      const submission = await store.findSubmissionForReview(
        documentId,
        applicationId,
      );
      if (submission === null) {
        throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
      }

      if (await store.isApplicationParticipant(applicationId, reviewerId)) {
        throw this.error(MilestoneDocumentsErrorCode.SELF_REVIEW_FORBIDDEN);
      }

      if (submission.revision !== input.expectedRevision) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const latestReviewId = await store.findLatestReviewIdForSubmission(
        submission.id,
      );
      if (latestReviewId !== input.expectedLatestReviewId) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const reviewedAt =
        this.milestoneDocumentSubmissionRepository.nextHistoryCreatedAt(
          now(),
          submission.latestHistoryCreatedAt,
        );

      if (
        input.resubmissionDueAt !== null &&
        input.resubmissionDueAt.getTime() <= reviewedAt.getTime()
      ) {
        throw this.error(
          MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
        );
      }

      const review = await store.createReview({
        milestoneDocumentSubmissionId: submission.id,
        submissionHistoryId: submission.submissionHistoryId,
        revision: submission.revision,
        reviewerId,
        decision: input.decision,
        comment: input.comment,
        resubmissionDueAt: input.resubmissionDueAt,
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

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
