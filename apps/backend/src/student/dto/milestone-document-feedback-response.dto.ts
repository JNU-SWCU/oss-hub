import type { ReviewDecision } from '@prisma/client';
import type { MilestoneDocumentFeedbackResult } from '../milestone-document-feedback.service';

export class MilestoneDocumentFeedbackItemResponseDto {
  declare readonly id: string;
  declare readonly decision: ReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;
  declare readonly resubmissionDueAt: string | null;
  declare readonly applicationId: string;
  declare readonly programId: string;
  declare readonly milestoneId: string;
  declare readonly milestoneName: string;
  declare readonly itemName: string;
  declare readonly href: string;

  static from(
    item: MilestoneDocumentFeedbackResult['items'][number],
  ): MilestoneDocumentFeedbackItemResponseDto {
    return {
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
    };
  }
}

export class MilestoneDocumentFeedbackResponseDto {
  declare readonly items: readonly MilestoneDocumentFeedbackItemResponseDto[];

  static from(
    result: MilestoneDocumentFeedbackResult,
  ): MilestoneDocumentFeedbackResponseDto {
    return {
      items: result.items.map((item) =>
        MilestoneDocumentFeedbackItemResponseDto.from(item),
      ),
    };
  }
}
