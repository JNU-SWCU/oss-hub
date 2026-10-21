import type { MilestoneDocumentHistoryResult } from '../domain/milestone-document-result';
import type { MilestoneDocumentSubmissionHistoryEvent } from '@prisma/client';
import type { MilestoneDocumentSubmittedContent } from '../domain/milestone-document-content';

interface MilestoneDocumentHistoryItemResponseDto {
  readonly event: MilestoneDocumentSubmissionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly fileName: string | null;

  readonly downloadUrl: string | null;
  readonly content: MilestoneDocumentSubmittedContent | null;
}

export interface MilestoneDocumentHistoryPageResponseDto {
  readonly items: readonly MilestoneDocumentHistoryItemResponseDto[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}

export function presentMilestoneDocumentHistory(
  result: MilestoneDocumentHistoryResult,
): MilestoneDocumentHistoryPageResponseDto {
  return {
    items: result.items.map((item) => ({
      event: item.event,
      revision: item.revision,
      actorNickname: item.actorNickname,
      comment: item.comment,
      createdAt: item.createdAt.toISOString(),
      fileName: item.fileName,
      downloadUrl:
        item.downloadableFileId === null
          ? null
          : `/api/v1/submission-files/${item.downloadableFileId}`,
      content: item.content,
    })),
    nextCursor: result.nextCursor,
    isComplete: result.isComplete,
  };
}
