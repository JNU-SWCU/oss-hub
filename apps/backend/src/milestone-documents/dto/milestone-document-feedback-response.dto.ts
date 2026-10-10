import type { ReviewDecision } from '@prisma/client';

export interface MilestoneDocumentFeedbackItemResponseDto {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
  readonly resubmissionDueAt: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly itemName: string;
  readonly href: string;
}

export interface MilestoneDocumentFeedbackResponseDto {
  readonly items: readonly MilestoneDocumentFeedbackItemResponseDto[];
}
