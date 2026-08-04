import { BoardCommentRecord } from '../board.repository';

/** 게시글 상세 응답 안 댓글 한 건, 그리고 댓글 작성 응답. */
export class BoardCommentResponseDto {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: string;

  private constructor(record: BoardCommentRecord) {
    this.id = record.id;
    this.postId = record.postId;
    this.authorId = record.authorId;
    this.body = record.body;
    this.createdAt = record.createdAt.toISOString();
  }

  static from(record: BoardCommentRecord): BoardCommentResponseDto {
    return new BoardCommentResponseDto(record);
  }
}
