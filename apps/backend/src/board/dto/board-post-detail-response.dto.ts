import { BoardPostCategory } from '@prisma/client';
import { BoardPostDetailResult } from '../board.service';
import { BoardCommentResponseDto } from './board-comment-response.dto';

/** `GET/POST/PATCH .../posts/:postId` 응답 — 본문과 댓글까지 포함한다. */
export class BoardPostDetailResponseDto {
  id: string;
  programId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  comments: BoardCommentResponseDto[];
  canEdit: boolean;
  canDelete: boolean;

  private constructor(record: BoardPostDetailResult) {
    this.id = record.id;
    this.programId = record.programId;
    this.authorName = record.authorName;
    this.category = record.category;
    this.title = record.title;
    this.body = record.body;
    this.pinned = record.pinned;
    this.createdAt = record.createdAt.toISOString();
    this.updatedAt = record.updatedAt.toISOString();
    this.commentCount = record.commentCount;
    this.canEdit = record.canEdit;
    this.canDelete = record.canDelete;
    this.comments = record.comments.map((comment) =>
      BoardCommentResponseDto.from(comment),
    );
  }

  static from(record: BoardPostDetailResult): BoardPostDetailResponseDto {
    return new BoardPostDetailResponseDto(record);
  }
}
