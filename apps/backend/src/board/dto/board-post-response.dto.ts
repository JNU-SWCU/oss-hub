import { BoardPostCategory } from '@prisma/client';
import { BoardPostSummaryRecord } from '../board.repository';

/** `GET /programs/:programId/board/posts` 응답 목록 항목 하나. */
export class BoardPostResponseDto {
  id: string;
  programId: string;
  authorId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  pinned: boolean;
  createdAt: string;
  commentCount: number;

  private constructor(record: BoardPostSummaryRecord) {
    this.id = record.id;
    this.programId = record.programId;
    this.authorId = record.authorId;
    this.authorName = record.authorName;
    this.category = record.category;
    this.title = record.title;
    this.pinned = record.pinned;
    this.createdAt = record.createdAt.toISOString();
    this.commentCount = record.commentCount;
  }

  static from(record: BoardPostSummaryRecord): BoardPostResponseDto {
    return new BoardPostResponseDto(record);
  }
}
