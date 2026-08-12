import { BoardPostCategory } from '@prisma/client';
import { BoardPostSummaryResult } from '../board.service';

/** `GET /programs/:programId/board/posts` 응답 목록 항목 하나. */
export class BoardPostResponseDto {
  id: string;
  programId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  pinned: boolean;
  createdAt: string;
  commentCount: number;
  canEdit: boolean;
  canDelete: boolean;

  private constructor(record: BoardPostSummaryResult) {
    this.id = record.id;
    this.programId = record.programId;
    this.authorName = record.authorName;
    this.category = record.category;
    this.title = record.title;
    this.pinned = record.pinned;
    this.createdAt = record.createdAt.toISOString();
    this.commentCount = record.commentCount;
    this.canEdit = record.canEdit;
    this.canDelete = record.canDelete;
  }

  static from(record: BoardPostSummaryResult): BoardPostResponseDto {
    return new BoardPostResponseDto(record);
  }
}
