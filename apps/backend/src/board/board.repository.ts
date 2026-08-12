import { Injectable } from '@nestjs/common';
import { BoardPostCategory, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 게시판 목록 화면 한 행 — 본문(body)은 목록에서 쓰지 않아 select에서 뺀다. */
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

/** 댓글 목록 화면 상세 조회에 쓰는 댓글 한 건. */
export interface BoardCommentRecord {
  id: string;
  postId: string;
  authorId: string;
  /** 작성자 `User.role`. null이면 학생으로 본다(게시판 참여자는 역할이 있어야 한다). */
  authorRole: Role;
  authorName: string;
  body: string;
  createdAt: Date;
}

/** 게시글 상세 화면 — 본문과 댓글까지 포함한다. */
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

/** update/delete 권한 판정에만 쓰는 가벼운 참조 — 본문·댓글을 싣지 않는다. */
export interface BoardPostRef {
  id: string;
  programId: string;
  authorId: string;
}

/** 댓글 delete 권한 판정에만 쓰는 가벼운 참조. */
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

const commentSelect = {
  id: true,
  postId: true,
  authorId: true,
  body: true,
  createdAt: true,
  author: { select: { role: true, name: true, nickname: true } },
} as const;

const postDetailSelect = {
  id: true,
  programId: true,
  authorId: true,
  author: { select: { name: true, nickname: true } },
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

  /** 고정 글이 항상 위, 그 안에서는 최신순 — 프로토타입 게시판 목록과 같은 정렬이다. */
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
          author: { select: { name: true, nickname: true } },
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
        authorName: post.author.name ?? post.author.nickname,
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

  /**
   * BoardComment.postId FK가 ON DELETE RESTRICT라 댓글을 먼저 지워야 글을 지울 수 있다
   * (migration 20260804110314). 두 삭제를 한 트랜잭션으로 묶는다.
   */
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
    role: Role | null;
    name: string | null;
    nickname: string;
  };
}

interface PostDetailRow {
  id: string;
  programId: string;
  authorId: string;
  author: { name: string | null; nickname: string };
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
    // 역할 미확정 작성자는 게시판 접근 경로상 거의 없지만, 표시는 학생으로 접는다.
    authorRole: comment.author.role ?? Role.STUDENT,
    authorName: comment.author.name ?? comment.author.nickname,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function toDetailRecord(post: PostDetailRow): BoardPostDetailRecord {
  return {
    id: post.id,
    programId: post.programId,
    authorId: post.authorId,
    authorName: post.author.name ?? post.author.nickname,
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
