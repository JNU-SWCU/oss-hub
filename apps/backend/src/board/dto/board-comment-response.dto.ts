import type { AuthorityLabel } from '../../users/domain/authority-label';
import { BoardCommentResult } from '../board.service';

/** 게시글 상세 응답 안 댓글 한 건, 그리고 댓글 작성 응답. */
export class BoardCommentResponseDto {
  id: string;
  postId: string;
  /**
   * 작성자 `User.role` 원본. ADMIN도 접지 않고 그대로 실어 보낸다 —
   * 표시 라벨(관리자→교직원 접기 등)은 프런트 상수 소유(ADR-008).
   */
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
