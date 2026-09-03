import type { MilestoneDocumentSubmissionHistoryEvent } from '@prisma/client';
import type { MilestoneDocumentSubmittedContent } from '../domain/milestone-document-content';

export interface MilestoneDocumentHistoryItemResponseDto {
  readonly event: MilestoneDocumentSubmissionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly fileName: string | null;
  /**
   * 이 사건의 첨부를 내려받는 주소(`GET /api/v1/submission-files/:fileId`). 내려받을 수
   * 없으면 null이다.
   *
   * ⚠ **이름이 있다고 주소가 있는 것은 아니다.** 보관 기한이 지나면 파일은 실제로
   * 지워지지만 이름은 원장에 남는다 — 그때 주소까지 채우면 눌러도 404가 나는 버튼이
   * 화면에 선다. 같은 규칙을 검토 화면이 이미 쓴다
   * (submission-reviews/submission-review-context.mapper.ts).
   */
  readonly downloadUrl: string | null;
  readonly content: MilestoneDocumentSubmittedContent | null;
}

export interface MilestoneDocumentHistoryPageResponseDto {
  readonly items: readonly MilestoneDocumentHistoryItemResponseDto[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}
