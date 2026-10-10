import { Injectable } from '@nestjs/common';
import { AccountStatus, BoardPostCategory } from '@prisma/client';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { DomainException } from '../../common/error-code';
import type { BoardPostListQuery } from '../domain/board-post-list-query';
import {
  BOARD_ERROR_CODES,
  BoardErrorCode,
} from '../domain/board-error-code.enum';
import type {
  BoardPostPermissions,
  BoardCommentResult,
  BoardPostDetailResult,
  BoardPostsPageResult,
} from '../domain/board-results';
import {
  BoardPostDetailRecord,
  BoardPostRef,
  BoardPostSummaryRecord,
  BoardRepository,
} from '../repository/board.repository';

export interface BoardPostWriteInput {
  title: string;
  body: string;
}

export interface BoardCommentWriteInput {
  body: string;
}

@Injectable()
export class BoardService {
  constructor(
    private readonly repository: BoardRepository,
    private readonly authority: UsersAuthorityService,
  ) {}

  async listPosts(
    programId: string,
    query: BoardPostListQuery,
    sessionGithubId: bigint,
  ): Promise<BoardPostsPageResult> {
    const { actorId, actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
    );
    const { items, total } = await this.repository.findByProgramId(
      programId,
      query.page,
      query.limit,
    );
    return {
      items: items.map((post) =>
        this.withPostPermissions(post, actorId, actorIsStaff),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getPostDetail(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
  ): Promise<BoardPostDetailResult> {
    const { actorId, actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
    );
    const post = await this.repository.findDetailById(postId);
    if (!post || post.programId !== programId) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.POST_NOT_FOUND],
      );
    }
    return this.withDetailPermissions(post, actorId, actorIsStaff);
  }

  async createPost(
    programId: string,
    sessionGithubId: bigint,
    input: BoardPostWriteInput,
  ): Promise<BoardPostDetailResult> {
    const { actorId, actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
    );
    const post = await this.repository.create({
      programId,
      authorId: actorId,
      category: actorIsStaff ? BoardPostCategory.NOTICE : BoardPostCategory.QNA,
      title: input.title,
      body: input.body,
    });
    return this.withDetailPermissions(post, actorId, actorIsStaff);
  }

  async updatePost(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
    input: BoardPostWriteInput,
  ): Promise<BoardPostDetailResult> {
    const { actorId } = await this.assertAccess(programId, sessionGithubId);
    const ref = await this.requirePostRef(programId, postId);
    if (ref.authorId !== actorId) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.NOT_AUTHOR]);
    }
    const post = await this.repository.update(postId, input);
    return this.withDetailPermissions(post, actorId, false);
  }

  async deletePost(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
  ): Promise<void> {
    const { actorId, actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
    );
    const ref = await this.requirePostRef(programId, postId);
    if (ref.authorId !== actorId && !actorIsStaff) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.NOT_AUTHOR]);
    }
    await this.repository.deleteWithComments(postId);
  }

  async setPinned(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
    pinned: boolean,
  ): Promise<void> {
    const { actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
    );
    if (!actorIsStaff) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.STAFF_ONLY]);
    }
    await this.requirePostRef(programId, postId);
    await this.repository.setPinned(postId, pinned);
  }

  async createComment(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
    input: BoardCommentWriteInput,
  ): Promise<BoardCommentResult> {
    const { actorId } = await this.assertAccess(programId, sessionGithubId);
    await this.requirePostRef(programId, postId);
    const comment = await this.repository.createComment({
      postId,
      authorId: actorId,
      body: input.body,
    });
    return { ...comment, canDelete: true };
  }

  async deleteComment(
    programId: string,
    postId: string,
    commentId: string,
    sessionGithubId: bigint,
  ): Promise<void> {
    const { actorId, actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
    );
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

  private async assertAccess(programId: string, sessionGithubId: bigint) {
    const forbidden = () =>
      new DomainException(BOARD_ERROR_CODES[BoardErrorCode.ACCESS_FORBIDDEN]);
    const actor = await this.repository.findAccessActor(sessionGithubId);
    if (!actor || actor.accountStatus !== AccountStatus.ACTIVE)
      throw forbidden();
    if (actor.hasStaffAccess || actor.hasAdminAccess) {
      const { actorId } = await this.authority.assertActiveStaff(
        sessionGithubId,
        forbidden,
      );
      return { actorId, actorIsStaff: true };
    }
    if (!(await this.repository.isApprovedParticipant(programId, actor.id)))
      throw forbidden();
    return { actorId: actor.id, actorIsStaff: false };
  }

  private withPostPermissions<
    T extends BoardPostSummaryRecord | BoardPostDetailRecord,
  >(post: T, actorId: string, actorIsStaff: boolean): T & BoardPostPermissions {
    const isAuthor = post.authorId === actorId;
    return {
      ...post,
      canEdit: isAuthor,
      canDelete: isAuthor || actorIsStaff,
    };
  }

  private withDetailPermissions(
    post: BoardPostDetailRecord,
    actorId: string,
    actorIsStaff: boolean,
  ): BoardPostDetailResult {
    return {
      ...this.withPostPermissions(post, actorId, actorIsStaff),
      comments: post.comments.map((comment) => ({
        ...comment,
        canDelete: comment.authorId === actorId || actorIsStaff,
      })),
    };
  }

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
