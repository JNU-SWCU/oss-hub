import type { MilestoneDocumentSubmissionHistoryEvent } from '@prisma/client';
import type { MilestoneDocumentSubmittedContent } from '../domain/milestone-document-content';

export interface MilestoneDocumentHistoryItemResponseDto {
  readonly event: MilestoneDocumentSubmissionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly fileName: string | null;
  readonly content: MilestoneDocumentSubmittedContent | null;
}

export interface MilestoneDocumentHistoryPageResponseDto {
  readonly items: readonly MilestoneDocumentHistoryItemResponseDto[];
  readonly nextCursor: string | null;
}
