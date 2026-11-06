import type { SubmissionHistoryEvent } from '@prisma/client';
import type { RequirementHistoryResult } from '../requirements.service';
import type { RequirementSubmittedContent } from '../requirements.repository';

export class RequirementHistoryItemResponseDto {
  declare readonly event: SubmissionHistoryEvent;
  declare readonly revision: number | null;
  declare readonly actorNickname: string;
  declare readonly comment: string | null;
  declare readonly createdAt: string;
  declare readonly fileName: string | null;

  declare readonly downloadUrl: string | null;
  declare readonly content: RequirementSubmittedContent | null;

  static from(
    item: RequirementHistoryResult['items'][number],
  ): RequirementHistoryItemResponseDto {
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

export class RequirementHistoryPageResponseDto {
  declare readonly items: readonly RequirementHistoryItemResponseDto[];
  declare readonly nextCursor: string | null;
  declare readonly isComplete: boolean;

  static from(
    result: RequirementHistoryResult,
  ): RequirementHistoryPageResponseDto {
    return {
      items: result.items.map((item) =>
        RequirementHistoryItemResponseDto.from(item),
      ),
      nextCursor: result.nextCursor,
      isComplete: result.isComplete,
    };
  }
}
