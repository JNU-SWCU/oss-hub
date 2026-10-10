import { Inject, Injectable } from '@nestjs/common';
import { MilestoneDocumentKind } from '@prisma/client';
import { isChangeRequestResubmissionOpen } from '../domain/milestone-document-submission-window';
import type {
  MilestoneDocumentFeedbackItemResponseDto,
  MilestoneDocumentFeedbackResponseDto,
} from '../dto/milestone-document-feedback-response.dto';
import {
  MilestoneDocumentFeedbackRepository,
  type RecentMilestoneDocumentReview,
} from '../repository/milestone-document-feedback.repository';

export const MILESTONE_DOCUMENT_FEEDBACK_CLOCK = Symbol(
  'MILESTONE_DOCUMENT_FEEDBACK_CLOCK',
);
export type MilestoneDocumentFeedbackClock = () => Date;

const FEEDBACK_WINDOW_DAYS = 7;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function feedbackWindowStart(now: Date): Date {
  const seoulDay = Math.floor((now.getTime() + SEOUL_OFFSET_MS) / DAY_MS);
  return new Date((seoulDay - FEEDBACK_WINDOW_DAYS) * DAY_MS - SEOUL_OFFSET_MS);
}

@Injectable()
export class MilestoneDocumentFeedbackService {
  constructor(
    @Inject(MilestoneDocumentFeedbackRepository)
    private readonly repository: Pick<
      MilestoneDocumentFeedbackRepository,
      'findRecentForParticipant'
    >,
    @Inject(MILESTONE_DOCUMENT_FEEDBACK_CLOCK)
    private readonly clock: MilestoneDocumentFeedbackClock,
  ) {}

  async recentForParticipant(
    sessionGithubId: bigint,
  ): Promise<MilestoneDocumentFeedbackResponseDto> {
    const reviews = await this.repository.findRecentForParticipant(
      sessionGithubId,
      feedbackWindowStart(this.clock()),
    );
    const reviewedSubmissions = new Set<string>();
    return {
      items: reviews.map((review) => {
        const isLatestReview = !reviewedSubmissions.has(review.submissionId);
        reviewedSubmissions.add(review.submissionId);
        return toFeedbackItem(review, isLatestReview);
      }),
    };
  }
}

function toFeedbackItem(
  review: RecentMilestoneDocumentReview,
  isLatestReview: boolean,
): MilestoneDocumentFeedbackItemResponseDto {
  const resubmissionOpen =
    isLatestReview &&
    isChangeRequestResubmissionOpen({
      latestDecision: review.decision,
      submissionStatus: review.submissionStatus,
    });
  return {
    id: review.id,
    decision: review.decision,
    comment: review.comment,
    reviewedAt: review.reviewedAt.toISOString(),
    resubmissionDueAt: resubmissionOpen
      ? (review.resubmissionDueAt?.toISOString() ?? null)
      : null,
    applicationId: review.applicationId,
    programId: review.programId,
    milestoneId: review.milestoneId,
    milestoneName: review.milestoneName,
    itemName:
      review.documentKind === MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION
        ? review.milestoneName
        : review.documentName,
    href: `/programs/${encodeURIComponent(review.programId)}/documents?milestoneId=${encodeURIComponent(review.milestoneId)}`,
  };
}
