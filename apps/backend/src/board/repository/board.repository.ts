import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  BoardPostCategory,
  type MemberKind,
} from '@prisma/client';
import { programApplicationParticipantWhere } from '../../programs/program-participant';
import { PrismaService } from '../../prisma/prisma.service';
import {
  authorityLabel,
  type AuthorityLabel,
} from '../../users/domain/authority-label';
import {
  type UserProfileNameSource,
  resolveUserProfileName,
} from '../../profiles/user-profile-read';

export interface BoardPostSummaryRecord {
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

export interface BoardPostsPage {
  items: BoardPostSummaryRecord[];
  total: number;
}

export interface BoardCommentRecord {
  id: string;
  postId: string;
  authorId: string;

  authorRole: AuthorityLabel;
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface BoardPostDetailRecord {
  id: string;
  programId: string;
  authorId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  commentCount: number;
  comments: BoardCommentRecord[];
}

export interface BoardPostRef {
  id: string;
  programId: string;
  authorId: string;
}

export interface BoardCommentRef {
  id: string;
  postId: string;
  programId: string;
  authorId: string;
}

export interface CreateBoardPostInput {
  programId: string;
  authorId: string;
  category: BoardPostCategory;
  title: string;
  body: string;
}

export interface UpdateBoardPostInput {
  title: string;
  body: string;
}

export interface CreateBoardCommentInput {
  postId: string;
  authorId: string;
  body: string;
}

const authorNameSelect = {
  nickname: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  profile: { select: { name: true, memberKind: true } },
} as const;

const commentSelect = {
  id: true,
  postId: true,
  authorId: true,
  body: true,
  createdAt: true,
  author: {
    select: authorNameSelect,
  },
} as const;

const postDetailSelect = {
  id: true,
  programId: true,
  authorId: true,
  author: {
    select: authorNameSelect,
  },
  category: true,
  title: true,
  body: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
  comments: {
    orderBy: { createdAt: 'asc' as const },
    select: commentSelect,
  },
  _count: { select: { comments: true } },
};

@Injectable()
export class BoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccessActor(sessionGithubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }

  async isApprovedParticipant(
    programId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.application.findFirst({
      where: {
        programId,
        status: ApplicationStatus.APPROVED,
        ...programApplicationParticipantWhere(userId),
      },
      select: { id: true },
    });
    return participant !== null;
  }

  async findByProgramId(
    programId: string,
    page: number,
    limit: number,
  ): Promise<BoardPostsPage> {
    const [posts, total] = await this.prisma.$transaction([
      this.prisma.boardPost.findMany({
        where: { programId },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          programId: true,
          authorId: true,
          author: {
            select: authorNameSelect,
          },
          category: true,
          title: true,
          pinned: true,
          createdAt: true,
          _count: { select: { comments: true } },
        },
      }),
      this.prisma.boardPost.count({ where: { programId } }),
    ]);
    return {
      items: posts.map((post) => ({
        id: post.id,
        programId: post.programId,
        authorId: post.authorId,
        authorName: resolveAuthorName(post.author),
        category: post.category,
        title: post.title,
        pinned: post.pinned,
        createdAt: post.createdAt,
        commentCount: post._count.comments,
      })),
      total,
    };
  }

  async findDetailById(postId: string): Promise<BoardPostDetailRecord | null> {
    const post = await this.prisma.boardPost.findUnique({
      where: { id: postId },
      select: postDetailSelect,
    });
    return post ? toDetailRecord(post) : null;
  }

  async findRefById(postId: string): Promise<BoardPostRef | null> {
    return this.prisma.boardPost.findUnique({
      where: { id: postId },
      select: { id: true, programId: true, authorId: true },
    });
  }

  async create(input: CreateBoardPostInput): Promise<BoardPostDetailRecord> {
    const post = await this.prisma.boardPost.create({
      data: {
        programId: input.programId,
        authorId: input.authorId,
        category: input.category,
        title: input.title,
        body: input.body,
      },
      select: postDetailSelect,
    });
    return toDetailRecord(post);
  }

  async update(
    postId: string,
    input: UpdateBoardPostInput,
  ): Promise<BoardPostDetailRecord> {
    const post = await this.prisma.boardPost.update({
      where: { id: postId },
      data: { title: input.title, body: input.body },
      select: postDetailSelect,
    });
    return toDetailRecord(post);
  }

  async deleteWithComments(postId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.boardComment.deleteMany({ where: { postId } }),
      this.prisma.boardPost.delete({ where: { id: postId } }),
    ]);
  }

  async setPinned(postId: string, pinned: boolean): Promise<void> {
    await this.prisma.boardPost.update({
      where: { id: postId },
      data: { pinned },
    });
  }

  async createComment(
    input: CreateBoardCommentInput,
  ): Promise<BoardCommentRecord> {
    const comment = await this.prisma.boardComment.create({
      data: {
        postId: input.postId,
        authorId: input.authorId,
        body: input.body,
      },
      select: commentSelect,
    });
    return toCommentRecord(comment);
  }

  async findCommentRefById(commentId: string): Promise<BoardCommentRef | null> {
    const comment = await this.prisma.boardComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        postId: true,
        authorId: true,
        post: { select: { programId: true } },
      },
    });
    if (!comment) return null;
    return {
      id: comment.id,
      postId: comment.postId,
      authorId: comment.authorId,
      programId: comment.post.programId,
    };
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.prisma.boardComment.delete({ where: { id: commentId } });
  }
}

interface CommentRow {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  author: {
    nickname: string;
    hasStaffAccess: boolean;
    hasAdminAccess: boolean;
    profile: { readonly name: string; readonly memberKind: MemberKind } | null;
  };
}

interface PostDetailRow {
  id: string;
  programId: string;
  authorId: string;
  author: UserProfileNameSource & { nickname: string };
  category: BoardPostCategory;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  comments: CommentRow[];
  _count: { comments: number };
}

function toCommentRecord(comment: CommentRow): BoardCommentRecord {
  return {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorId,

    authorRole:
      authorityLabel({
        memberKind: comment.author.profile?.memberKind ?? null,
        hasStaffAccess: comment.author.hasStaffAccess,
        hasAdminAccess: comment.author.hasAdminAccess,
      }) ?? 'STUDENT',
    authorName: resolveAuthorName(comment.author),
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function toDetailRecord(post: PostDetailRow): BoardPostDetailRecord {
  return {
    id: post.id,
    programId: post.programId,
    authorId: post.authorId,
    authorName: resolveAuthorName(post.author),
    category: post.category,
    title: post.title,
    body: post.body,
    pinned: post.pinned,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    commentCount: post._count.comments,
    comments: post.comments.map(toCommentRecord),
  };
}

function resolveAuthorName(
  author: UserProfileNameSource & { nickname: string },
): string {
  return resolveUserProfileName(author) ?? author.nickname;
}
