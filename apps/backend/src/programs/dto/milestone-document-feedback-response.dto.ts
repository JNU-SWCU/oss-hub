import type { MilestoneDocumentFeedbackResult } from '../milestone-document-result.types';
import type { ReviewDecision } from '@prisma/client';

interface MilestoneDocumentFeedbackItemResponseDto {
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

export function presentMilestoneDocumentFeedback(
  result: MilestoneDocumentFeedbackResult,
): MilestoneDocumentFeedbackResponseDto {
  return {
    items: result.items.map((item) => ({
      id: item.id,
      decision: item.decision,
      comment: item.comment,
      reviewedAt: item.reviewedAt.toISOString(),
      resubmissionDueAt: item.resubmissionDueAt?.toISOString() ?? null,
      applicationId: item.applicationId,
      programId: item.programId,
      milestoneId: item.milestoneId,
      milestoneName: item.milestoneName,
      itemName: item.itemName,
      href: `/programs/${encodeURIComponent(item.programId)}/documents?milestoneId=${encodeURIComponent(item.milestoneId)}`,
    })),
  };
}
