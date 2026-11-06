import type { AuthorityLabel } from '../users/authority-label.types';
import { Injectable } from '@nestjs/common';
import { AccountStatus, BoardPostCategory } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { BOARD_ERROR_CODES, BoardErrorCode } from './board.error';
import {
  BoardCommentRecord,
  BoardPostDetailRecord,
  BoardPostRef,
  BoardPostSummaryRecord,
  BoardRepository,
} from './board.repository';
import { UserProfileService } from '../users/user-profile.service';

export interface BoardPostListQuery {
  readonly page: number;
  readonly limit: number;
}

export interface BoardPostPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

export interface BoardPostSummaryResult extends BoardPostPermissions {
  id: string;
  programId: string;
  authorId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  pinned: boolean;
  createdAt: Date;
  commentCount: number;
}

export interface BoardCommentResult {
  id: string;
  postId: string;
  authorId: string;
  authorRole: AuthorityLabel;
  authorName: string;
  body: string;
  createdAt: Date;
  canDelete: boolean;
}

export interface BoardPostDetailResult extends BoardPostSummaryResult {
  body: string;
  updatedAt: Date;
  comments: BoardCommentResult[];
}

export interface BoardPostsPageResult {
  items: BoardPostSummaryResult[];
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

type BoardActorAccess = {
  readonly actorId: string;
  readonly actorIsStaff: boolean;
  readonly canWrite: boolean;
};

@Injectable()
export class BoardService {
  constructor(
    private readonly repository: BoardRepository,
    private readonly userProfileService: UserProfileService,
  ) {}

  listQueryFromRequest(request: {
    readonly page?: number;
    readonly limit?: number;
  }): BoardPostListQuery {
    return { page: request.page ?? 1, limit: request.limit ?? 20 };
  }

  async listPosts(
    programId: string,
    request: { readonly page?: number; readonly limit?: number },
    sessionGithubId: bigint,
  ): Promise<BoardPostsPageResult> {
    const query = this.listQueryFromRequest(request);
    const access = await this.assertAccess(programId, sessionGithubId);
    const { items, total } = await this.repository.findByProgramId(
      programId,
      query.page,
      query.limit,
    );
    return {
      items: items.map((post) => this.withPostPermissions(post, access)),
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
    const access = await this.assertAccess(programId, sessionGithubId);
    const post = await this.repository.findDetailById(postId);
    if (!post || post.programId !== programId) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.POST_NOT_FOUND],
      );
    }
    return this.withDetailPermissions(post, access);
  }

  async createPost(
    programId: string,
    sessionGithubId: bigint,
    input: BoardPostWriteInput,
  ): Promise<BoardPostDetailResult> {
    const access = await this.assertAccess(programId, sessionGithubId, true);
    const post = await this.repository.create({
      programId,
      authorId: access.actorId,
      category: access.actorIsStaff
        ? BoardPostCategory.NOTICE
        : BoardPostCategory.QNA,
      title: input.title,
      body: input.body,
    });
    return this.withDetailPermissions(post, access);
  }

  async updatePost(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
    input: BoardPostWriteInput,
  ): Promise<BoardPostDetailResult> {
    const access = await this.assertAccess(programId, sessionGithubId, true);
    const ref = await this.requirePostRef(programId, postId);
    if (ref.authorId !== access.actorId) {
      throw new DomainException(BOARD_ERROR_CODES[BoardErrorCode.NOT_AUTHOR]);
    }
    const post = await this.repository.update(postId, input);
    return this.withDetailPermissions(post, access);
  }

  async deletePost(
    programId: string,
    postId: string,
    sessionGithubId: bigint,
  ): Promise<void> {
    const { actorId, actorIsStaff } = await this.assertAccess(
      programId,
      sessionGithubId,
      true,
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
      true,
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
    const { actorId } = await this.assertAccess(
      programId,
      sessionGithubId,
      true,
    );
    await this.requirePostRef(programId, postId);
    const comment = await this.repository.createComment({
      postId,
      authorId: actorId,
      body: input.body,
    });
    return { ...this.toComment(comment), canDelete: true };
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
      true,
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

  private async assertAccess(
    programId: string,
    sessionGithubId: bigint,
    mutation = false,
  ): Promise<BoardActorAccess> {
    const forbidden = () =>
      new DomainException(BOARD_ERROR_CODES[BoardErrorCode.ACCESS_FORBIDDEN]);
    if (!(await this.repository.programExists(programId))) throw forbidden();
    const actor = await this.repository.findAccessActor(sessionGithubId);
    if (!actor || actor.accountStatus !== AccountStatus.ACTIVE)
      throw forbidden();
    if (
      this.userProfileService.isStaffEligible({
        accountStatus: actor.accountStatus,
        memberKind: actor.type === 'UNSELECTED' ? null : actor.type,
        hasStaffAccess:
          actor.type === 'STAFF' && actor.approvalStatus === 'APPROVED',
        isProfileComplete:
          actor.profileCreatedAt !== null &&
          this.userProfileService.isCompleteProfileFields(
            { ...actor, studentId: null },
            'STAFF',
          ),
      })
    ) {
      return { actorId: actor.id, actorIsStaff: true, canWrite: true };
    }
    if (mutation && actor.type !== 'STUDENT') throw forbidden();
    if (!(await this.repository.isApprovedParticipant(programId, actor.id)))
      throw forbidden();
    return {
      actorId: actor.id,
      actorIsStaff: false,
      canWrite: actor.type === 'STUDENT',
    };
  }

  private withPostPermissions<
    T extends BoardPostSummaryRecord | BoardPostDetailRecord,
  >(post: T, actor: BoardActorAccess): T & BoardPostPermissions {
    const isAuthor = post.authorId === actor.actorId;
    return {
      ...post,
      canEdit: actor.canWrite && isAuthor,
      canDelete: actor.canWrite && (isAuthor || actor.actorIsStaff),
    };
  }

  private withDetailPermissions(
    post: BoardPostDetailRecord,
    actor: BoardActorAccess,
  ): BoardPostDetailResult {
    return {
      ...this.withPostPermissions(post, actor),
      comments: post.comments.map((comment) => ({
        ...this.toComment(comment),
        canDelete:
          actor.canWrite &&
          (comment.authorId === actor.actorId || actor.actorIsStaff),
      })),
    };
  }

  private toComment(
    comment: BoardCommentRecord,
  ): Omit<BoardCommentResult, 'canDelete'> {
    return {
      id: comment.id,
      postId: comment.postId,
      authorId: comment.authorId,
      authorRole:
        this.userProfileService.authorityLabel({
          memberKind: comment.authorMemberKind,
          hasStaffAccess: comment.authorHasStaffAccess,
          hasAdminAccess: comment.authorHasAdminAccess,
        }) ?? 'STUDENT',
      authorName: comment.authorName,
      body: comment.body,
      createdAt: comment.createdAt,
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
