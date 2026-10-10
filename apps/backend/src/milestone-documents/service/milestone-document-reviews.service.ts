import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { DomainException } from '../../common/error-code';
import {
  type CreateMilestoneDocumentReviewInput,
  reviewDecisionToSubmissionStatus,
} from '../domain/milestone-document-review';
import { MilestoneDocumentReviewResponseDto } from '../dto/milestone-document-review-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';
import { nextMilestoneDocumentHistoryCreatedAt } from '../repository/milestone-document-history';
import { MilestoneDocumentsRepository } from '../repository/milestone-documents.repository';

@Injectable()
export class MilestoneDocumentReviewsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

  async review(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    input: CreateMilestoneDocumentReviewInput,
    now: () => Date = () => new Date(),
  ): Promise<MilestoneDocumentReviewResponseDto> {
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

      if (submission.revision !== input.expectedRevision) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const latestReviewId = await store.findLatestReviewIdForSubmission(
        submission.id,
      );
      if (latestReviewId !== input.expectedLatestReviewId) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const reviewedAt = nextMilestoneDocumentHistoryCreatedAt(
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
        reviewDecisionToSubmissionStatus(input.decision),
      );
      return review;
    });

    return MilestoneDocumentReviewResponseDto.from(created);
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
