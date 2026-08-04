import { Role } from '@prisma/client';
import { BoardCommentRecord } from '../board.repository';

/** 게시글 상세 응답 안 댓글 한 건, 그리고 댓글 작성 응답. */
export class BoardCommentResponseDto {
  id: string;
  postId: string;
  authorId: string;
  /**
   * 작성자 `User.role` 원본. ADMIN도 접지 않고 그대로 실어 보낸다 —
   * 표시 라벨(관리자→교직원 접기 등)은 프런트 상수 소유(ADR-008).
   */
  authorRole: Role;
  body: string;
  createdAt: string;

  private constructor(record: BoardCommentRecord) {
    this.id = record.id;
    this.postId = record.postId;
    this.authorId = record.authorId;
    this.authorRole = record.authorRole;
    this.body = record.body;
    this.createdAt = record.createdAt.toISOString();
  }

  static from(record: BoardCommentRecord): BoardCommentResponseDto {
    return new BoardCommentResponseDto(record);
  }
}
