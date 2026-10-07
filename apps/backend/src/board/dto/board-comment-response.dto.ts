import type { AuthorityLabel } from '../../common/authority-label';
import { BoardCommentResult } from '../board.service';

export class BoardCommentResponseDto {
  id: string;
  postId: string;

  authorRole: AuthorityLabel;
  authorName: string;
  body: string;
  createdAt: string;
  canDelete: boolean;

  private constructor(record: BoardCommentResult) {
    this.id = record.id;
    this.postId = record.postId;
    this.authorRole = record.authorRole;
    this.authorName = record.authorName;
    this.body = record.body;
    this.createdAt = record.createdAt.toISOString();
    this.canDelete = record.canDelete;
  }

  static from(record: BoardCommentResult): BoardCommentResponseDto {
    return new BoardCommentResponseDto(record);
  }
}
