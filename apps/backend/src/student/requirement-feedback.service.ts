import { Inject, Injectable } from '@nestjs/common';
import {
  RequirementFeedbackRepository,
  type RecentRequirementReview,
} from './requirement-feedback.repository';
import type { SubmissionReviewDecision } from '../programs/submissions.repository';
interface RequirementFeedbackItemResult {
  readonly id: string;
  readonly decision: SubmissionReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly teamId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly itemName: string;
}
export interface RequirementFeedbackResult {
  readonly items: readonly RequirementFeedbackItemResult[];
}
export const REQUIREMENT_FEEDBACK_CLOCK = Symbol('REQUIREMENT_FEEDBACK_CLOCK');
export type RequirementFeedbackClock = () => Date;
const FEEDBACK_WINDOW_DAYS = 7;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
function feedbackWindowStart(now: Date): Date {
  const seoulDay = Math.floor((now.getTime() + SEOUL_OFFSET_MS) / DAY_MS);
  return new Date((seoulDay - FEEDBACK_WINDOW_DAYS) * DAY_MS - SEOUL_OFFSET_MS);
}
@Injectable()
export class RequirementFeedbackService {
  constructor(
    @Inject(RequirementFeedbackRepository)
    private readonly repository: Pick<
      RequirementFeedbackRepository,
      'findRecentForParticipant'
    >,
    @Inject(REQUIREMENT_FEEDBACK_CLOCK)
    private readonly clock: RequirementFeedbackClock,
  ) {}
  async recentForParticipant(
    sessionGithubId: bigint,
  ): Promise<RequirementFeedbackResult> {
    const reviews = await this.repository.findRecentForParticipant(
      sessionGithubId,
      feedbackWindowStart(this.clock()),
    );
    return { items: reviews.map((review) => this.toFeedbackItem(review)) };
  }
  private toFeedbackItem(
    review: RecentRequirementReview,
  ): RequirementFeedbackItemResult {
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt,
      teamId: review.teamId,
      programId: review.programId,
      milestoneId: review.milestoneId,
      milestoneName: review.milestoneName,
      itemName: review.documentName,
    };
  }
}
