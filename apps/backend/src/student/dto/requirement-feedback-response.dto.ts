import type { RequirementFeedbackResult } from '../requirement-feedback.service';
import type { SubmissionReviewDecision } from '../../programs/submissions.repository';
export class RequirementFeedbackItemResponseDto {
  declare readonly id: string;
  declare readonly decision: SubmissionReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;
  declare readonly teamId: string;
  declare readonly programId: string;
  declare readonly milestoneId: string;
  declare readonly milestoneName: string;
  declare readonly itemName: string;
  declare readonly href: string;
  static from(
    item: RequirementFeedbackResult['items'][number],
  ): RequirementFeedbackItemResponseDto {
    return {
      id: item.id,
      decision: item.decision,
      comment: item.comment,
      reviewedAt: item.reviewedAt.toISOString(),
      teamId: item.teamId,
      programId: item.programId,
      milestoneId: item.milestoneId,
      milestoneName: item.milestoneName,
      itemName: item.itemName,
      href: `/programs/${encodeURIComponent(item.programId)}/documents?milestoneId=${encodeURIComponent(item.milestoneId)}`,
    };
  }
}
export class RequirementFeedbackResponseDto {
  declare readonly items: readonly RequirementFeedbackItemResponseDto[];
  static from(
    result: RequirementFeedbackResult,
  ): RequirementFeedbackResponseDto {
    return {
      items: result.items.map((item) =>
        RequirementFeedbackItemResponseDto.from(item),
      ),
    };
  }
}
