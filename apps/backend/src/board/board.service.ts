import { Injectable } from '@nestjs/common';
import { BoardPostCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { BoardPostListQuery } from './board-post-list-query';
import { BOARD_ERROR_CODES, BoardErrorCode } from './board-error-code.enum';
import {
  BoardCommentRecord,
  BoardPostDetailRecord,
  BoardPostRef,
  BoardPostSummaryRecord,
  BoardRepository,
} from './board.repository';

export interface BoardPostsPageResult {
  items: BoardPostSummaryRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface BoardPostWriteInput {
  title: string;
  body: string;
}

export interface BoardCommentWriteInput {
  body: string;
}

/**
 * 프로그램 게시판(BoardPost/BoardComment)의 목록·상세·작성·수정·삭제와 댓글
 * 작성·삭제, 교직원 전용 고정(pin)을 담당한다. 접근 권한(프로그램 참여자/교직원)
 * 자체는 BoardAccessGuard가 처리하고, 여기서는 그 뒤의 소유권·역할별 규칙만 본다.
 */
@Injectable()
export class BoardService {
  constructor(private readonly repository: BoardRepository) {}

  async listPosts(
    programId: string,
    query: BoardPostListQuery,
  ): Promise<BoardPostsPageResult> {
    const { items, total } = await this.repository.findByProgramId(
      programId,
      query.page,
      query.limit,
    );
    return { items, total, page: query.page, limit: query.limit };
  }

  async getPostDetail(
    programId: string,
    postId: string,
  ): Promise<BoardPostDetailRecord> {
    const post = await this.repository.findDetailById(postId);
    if (!post || post.programId !== programId) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.POST_NOT_FOUND],
      );
    }
    return post;
  }

  /** 글 종류는 사용자가 고르지 않는다 — 작성자 역할이 그대로 결정한다(프로토타입 계약). */
  async createPost(
    programId: string,
    actorId: string,
    actorIsStaff: boolean,
    input: BoardPostWriteInput,
  ): Promise<BoardPostDetailRecord> {
    return this.repository.create({
      programId,
      authorId: actorId,
      category: actorIsStaff ? BoardPostCategory.NOTICE : BoardPostCategory.QNA,
      title: input.title,
      body: input.body,
    });
  }

  /** 수정은 작성자 본인만 — 교직원도 남의 글은 수정할 수 없다(삭제와 다름). */
  async updatePost(
    programId: string,
    postId: string,
    actorId: string,
    input: BoardPostWriteInput,
  ): Promise<BoardPostDetailRecord> {
    const ref = await this.requirePostRef(programId, postId);
    if (ref.authorId !== actorId) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.NOT_AUTHOR]);
    }
    return this.repository.update(postId, input);
  }

  /** 삭제는 작성자 본인이거나 교직원. */
  async deletePost(
    programId: string,
    postId: string,
    actorId: string,
    actorIsStaff: boolean,
  ): Promise<void> {
    const ref = await this.requirePostRef(programId, postId);
    if (ref.authorId !== actorId && !actorIsStaff) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.NOT_AUTHOR]);
    }
    await this.repository.deleteWithComments(postId);
  }

  /** 고정은 교직원만 — 작성자 여부와 무관하다. */
  async setPinned(
    programId: string,
    postId: string,
    actorIsStaff: boolean,
    pinned: boolean,
  ): Promise<void> {
    if (!actorIsStaff) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.STAFF_ONLY]);
    }
    await this.requirePostRef(programId, postId);
    await this.repository.setPinned(postId, pinned);
  }

  async createComment(
    programId: string,
    postId: string,
    actorId: string,
    input: BoardCommentWriteInput,
  ): Promise<BoardCommentRecord> {
    await this.requirePostRef(programId, postId);
    return this.repository.createComment({
      postId,
      authorId: actorId,
      body: input.body,
    });
  }

  /** 댓글 삭제는 작성자 본인이거나 교직원. */
  async deleteComment(
    programId: string,
    postId: string,
    commentId: string,
    actorId: string,
    actorIsStaff: boolean,
  ): Promise<void> {
    const ref = await this.repository.findCommentRefById(commentId);
    if (!ref || ref.postId !== postId || ref.programId !== programId) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.COMMENT_NOT_FOUND],
      );
    }
    if (ref.authorId !== actorId && !actorIsStaff) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.NOT_AUTHOR]);
    }
    await this.repository.deleteComment(commentId);
  }

  /** postId가 route의 programId 소속인지까지 확인한다 — 다른 프로그램 글은 404로 감춘다. */
  private async requirePostRef(
    programId: string,
    postId: string,
  ): Promise<BoardPostRef> {
    const ref = await this.repository.findRefById(postId);
    if (!ref || ref.programId !== programId) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.POST_NOT_FOUND],
      );
    }
    return ref;
  }
}
