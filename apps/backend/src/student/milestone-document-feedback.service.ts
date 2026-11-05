import { Inject, Injectable } from '@nestjs/common';
import { type ReviewDecision } from '@prisma/client';
import {
  MilestoneDocumentFeedbackRepository,
  type RecentMilestoneDocumentReview,
} from './milestone-document-feedback.repository';
interface MilestoneDocumentFeedbackItemResult {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly applicationId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly itemName: string;
}
export interface MilestoneDocumentFeedbackResult {
  readonly items: readonly MilestoneDocumentFeedbackItemResult[];
}
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
  ): Promise<MilestoneDocumentFeedbackResult> {
    const reviews = await this.repository.findRecentForParticipant(
      sessionGithubId,
      feedbackWindowStart(this.clock()),
    );
    return { items: reviews.map((review) => this.toFeedbackItem(review)) };
  }
  private toFeedbackItem(
    review: RecentMilestoneDocumentReview,
  ): MilestoneDocumentFeedbackItemResult {
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt,
      applicationId: review.applicationId,
      programId: review.programId,
      milestoneId: review.milestoneId,
      milestoneName: review.milestoneName,
      itemName: review.documentName,
    };
  }
}
