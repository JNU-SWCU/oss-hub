import type { MilestoneDocumentHistoryResult } from '../milestone-document-result.types';
import type { MilestoneDocumentSubmissionHistoryEvent } from '@prisma/client';
import type { MilestoneDocumentSubmittedContent } from '../milestone-document.policy';

export class MilestoneDocumentHistoryItemResponseDto {
  declare readonly event: MilestoneDocumentSubmissionHistoryEvent;
  declare readonly revision: number | null;
  declare readonly actorNickname: string;
  declare readonly comment: string | null;
  declare readonly createdAt: string;
  declare readonly fileName: string | null;

  declare readonly downloadUrl: string | null;
  declare readonly content: MilestoneDocumentSubmittedContent | null;

  static from(
    item: MilestoneDocumentHistoryResult['items'][number],
  ): MilestoneDocumentHistoryItemResponseDto {
    return {
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
    };
  }
}

export class MilestoneDocumentHistoryPageResponseDto {
  declare readonly items: readonly MilestoneDocumentHistoryItemResponseDto[];
  declare readonly nextCursor: string | null;
  declare readonly isComplete: boolean;

  static from(
    result: MilestoneDocumentHistoryResult,
  ): MilestoneDocumentHistoryPageResponseDto {
    return {
      items: result.items.map((item) =>
        MilestoneDocumentHistoryItemResponseDto.from(item),
      ),
      nextCursor: result.nextCursor,
      isComplete: result.isComplete,
    };
  }
}
