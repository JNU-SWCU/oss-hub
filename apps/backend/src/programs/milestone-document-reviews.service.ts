import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../users/users-authority.service';
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
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';

@Injectable()
export class MilestoneDocumentReviewsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
  ) {}

  async review(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    input: CreateMilestoneDocumentReviewInput,
    now: () => Date = () => new Date(),
  ): Promise<CreatedMilestoneDocumentReview> {
    const { actorId: reviewerId } = await this.authority.assertActiveStaff(
      sessionGithubId,
      () => this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
        MilestoneDocumentSubmissionRepository.nextHistoryCreatedAt(
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
        this.milestoneDocumentRulesService.reviewDecisionToSubmissionStatus(
          input.decision,
        ),
      );
      return review;
    });

    return created;
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
