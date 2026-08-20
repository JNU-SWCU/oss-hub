import { BoardPostCategory, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BoardRepository } from './board.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticPostId = 'cuid-synthetic-post';
const syntheticCommentId = 'cuid-synthetic-comment';
const syntheticAuthorId = 'cuid-synthetic-author';
const expectedAuthorNameSelect = {
  name: true,
  profile: { select: { name: true } },
  nickname: true,
} as const;
const expectedCommentAuthorSelect = {
  role: true,
  ...expectedAuthorNameSelect,
} as const;

describe('BoardRepository.findByProgramId', () => {
  it('page/limit을 skip/take로 변환하고 고정글·최신순으로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    const prisma = {
      boardPost: { findMany, count },
      $transaction: transaction,
    } as unknown as PrismaService;

    await new BoardRepository(prisma).findByProgramId(
      syntheticProgramId,
      3,
      10,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { programId: syntheticProgramId },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: 20,
        take: 10,
      }),
    );
  });

  it('_count.comments를 commentCount로 평탄화한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: syntheticPostId,
        programId: syntheticProgramId,
        authorId: syntheticAuthorId,
        author: { name: '합성 운영자', nickname: 'synthetic-staff' },
        category: BoardPostCategory.NOTICE,
        title: '제목',
        pinned: true,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        _count: { comments: 4 },
      },
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    const prisma = {
      boardPost: { findMany, count },
      $transaction: transaction,
    } as unknown as PrismaService;

    const page = await new BoardRepository(prisma).findByProgramId(
      syntheticProgramId,
      1,
      20,
    );

    expect(page).toEqual({
      items: [
        {
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
          authorName: '합성 운영자',
          category: BoardPostCategory.NOTICE,
          title: '제목',
          pinned: true,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          commentCount: 4,
        },
      ],
      total: 1,
    });
  });
});

describe('BoardRepository authorName', () => {
  it('목록 게시글은 name을 우선하고 없으면 nickname으로 폴백한다', async () => {
    const common = {
      programId: syntheticProgramId,
      category: BoardPostCategory.QNA,
      title: '합성 질문',
      pinned: false,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      _count: { comments: 0 },
    };
    const findMany = jest.fn().mockResolvedValue([
      {
        ...common,
        id: syntheticPostId,
        authorId: syntheticAuthorId,
        author: { name: '합성 학생', nickname: 'synthetic-author' },
      },
      {
        ...common,
        id: 'cuid-synthetic-post-fallback',
        authorId: 'cuid-synthetic-author-fallback',
        author: { name: null, nickname: 'synthetic-fallback' },
      },
    ]);
    const prisma = {
      boardPost: { findMany, count: jest.fn().mockResolvedValue(2) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;

    const page = await new BoardRepository(prisma).findByProgramId(
      syntheticProgramId,
      1,
      20,
    );

    expect(page.items.map((item) => item.authorName)).toEqual([
      '합성 학생',
      'synthetic-fallback',
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          author: { select: expectedAuthorNameSelect },
        }) as unknown,
      }),
    );
  });

  it('상세 게시글과 댓글에도 name 우선·nickname 폴백 표시이름을 평탄화한다', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');
    const findUnique = jest.fn().mockResolvedValue({
      id: syntheticPostId,
      programId: syntheticProgramId,
      authorId: syntheticAuthorId,
      author: { name: null, nickname: 'synthetic-author' },
      category: BoardPostCategory.QNA,
      title: '합성 질문',
      body: '합성 본문',
      pinned: false,
      createdAt,
      updatedAt: createdAt,
      comments: [
        {
          id: syntheticCommentId,
          postId: syntheticPostId,
          authorId: 'cuid-synthetic-staff',
          author: {
            role: Role.STAFF,
            name: '합성 교직원',
            nickname: 'synthetic-staff',
          },
          body: '합성 답변',
          createdAt,
        },
      ],
      _count: { comments: 1 },
    });
    const prisma = {
      boardPost: { findUnique },
    } as unknown as PrismaService;

    const detail = await new BoardRepository(prisma).findDetailById(
      syntheticPostId,
    );

    expect(detail?.authorName).toBe('synthetic-author');
    expect(detail?.comments[0]?.authorName).toBe('합성 교직원');
  });
});

describe('BoardRepository.deleteWithComments', () => {
  it('댓글을 먼저 지우고 글을 지운다 (FK ON DELETE RESTRICT)', async () => {
    const deleteMany = jest.fn();
    const deletePost = jest.fn();
    const transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    const prisma = {
      boardComment: { deleteMany },
      boardPost: { delete: deletePost },
      $transaction: transaction,
    } as unknown as PrismaService;

    await new BoardRepository(prisma).deleteWithComments(syntheticPostId);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { postId: syntheticPostId },
    });
    expect(deletePost).toHaveBeenCalledWith({
      where: { id: syntheticPostId },
    });
    const [ops] = transaction.mock.calls[0] as [unknown[]];
    expect(ops).toHaveLength(2);
  });
});

describe('BoardRepository.findCommentRefById', () => {
  it('post.programId를 programId 필드로 평탄화한다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      post: { programId: syntheticProgramId },
    });
    const prisma = {
      boardComment: { findUnique },
    } as unknown as PrismaService;

    const ref = await new BoardRepository(prisma).findCommentRefById(
      syntheticCommentId,
    );

    expect(ref).toEqual({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      programId: syntheticProgramId,
    });
  });

  it('댓글이 없으면 null을 반환한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      boardComment: { findUnique },
    } as unknown as PrismaService;

    const ref = await new BoardRepository(prisma).findCommentRefById(
      syntheticCommentId,
    );

    expect(ref).toBeNull();
  });
});

describe('BoardRepository.findDetailById', () => {
  it('댓글 author.role을 authorRole로 평탄화한다', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');
    const updatedAt = new Date('2026-07-01T00:00:00.000Z');
    const commentAt = new Date('2026-07-01T01:00:00.000Z');
    const findUnique = jest.fn().mockResolvedValue({
      id: syntheticPostId,
      programId: syntheticProgramId,
      authorId: syntheticAuthorId,
      author: { name: '합성 질문자', nickname: 'synthetic-author' },
      category: BoardPostCategory.QNA,
      title: '제목',
      body: '본문',
      pinned: false,
      createdAt,
      updatedAt,
      comments: [
        {
          id: syntheticCommentId,
          postId: syntheticPostId,
          authorId: 'cuid-synthetic-staff',
          body: '교직원 답변',
          createdAt: commentAt,
          author: {
            role: Role.STAFF,
            name: '합성 교직원',
            nickname: 'synthetic-staff',
          },
        },
        {
          id: 'cuid-synthetic-comment-student',
          postId: syntheticPostId,
          authorId: syntheticAuthorId,
          body: '학생 의견',
          createdAt: commentAt,
          author: {
            role: Role.STUDENT,
            name: null,
            nickname: 'synthetic-student',
          },
        },
        {
          id: 'cuid-synthetic-comment-admin',
          postId: syntheticPostId,
          authorId: 'cuid-synthetic-admin',
          body: '관리자 답변',
          createdAt: commentAt,
          author: {
            role: Role.ADMIN,
            name: '합성 관리자',
            nickname: 'synthetic-admin',
          },
        },
      ],
      _count: { comments: 3 },
    });
    const prisma = {
      boardPost: { findUnique },
    } as unknown as PrismaService;

    const detail = await new BoardRepository(prisma).findDetailById(
      syntheticPostId,
    );

    expect(detail?.comments).toEqual([
      {
        id: syntheticCommentId,
        postId: syntheticPostId,
        authorId: 'cuid-synthetic-staff',
        authorRole: Role.STAFF,
        authorName: '합성 교직원',
        body: '교직원 답변',
        createdAt: commentAt,
      },
      {
        id: 'cuid-synthetic-comment-student',
        postId: syntheticPostId,
        authorId: syntheticAuthorId,
        authorRole: Role.STUDENT,
        authorName: 'synthetic-student',
        body: '학생 의견',
        createdAt: commentAt,
      },
      {
        id: 'cuid-synthetic-comment-admin',
        postId: syntheticPostId,
        authorId: 'cuid-synthetic-admin',
        authorRole: Role.ADMIN,
        authorName: '합성 관리자',
        body: '관리자 답변',
        createdAt: commentAt,
      },
    ]);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          comments: expect.objectContaining({
            select: expect.objectContaining({
              author: { select: expectedCommentAuthorSelect },
            }) as unknown,
          }) as unknown,
        }) as unknown,
      }),
    );
  });

  it('author.role이 null이면 authorRole을 STUDENT로 접는다', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');
    const findUnique = jest.fn().mockResolvedValue({
      id: syntheticPostId,
      programId: syntheticProgramId,
      authorId: syntheticAuthorId,
      author: { name: null, nickname: 'synthetic-author' },
      category: BoardPostCategory.QNA,
      title: '제목',
      body: '본문',
      pinned: false,
      createdAt,
      updatedAt: createdAt,
      comments: [
        {
          id: syntheticCommentId,
          postId: syntheticPostId,
          authorId: syntheticAuthorId,
          body: '역할 미확정',
          createdAt,
          author: {
            role: null,
            name: null,
            nickname: 'synthetic-author',
          },
        },
      ],
      _count: { comments: 1 },
    });
    const prisma = {
      boardPost: { findUnique },
    } as unknown as PrismaService;

    const detail = await new BoardRepository(prisma).findDetailById(
      syntheticPostId,
    );

    expect(detail?.comments[0]?.authorRole).toBe(Role.STUDENT);
  });
});

describe('BoardRepository.createComment', () => {
  it('작성 응답에 author.role을 authorRole로 실어 보낸다', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');
    const create = jest.fn().mockResolvedValue({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      body: '새 댓글',
      createdAt,
      author: {
        role: Role.STUDENT,
        name: null,
        nickname: 'synthetic-author',
      },
    });
    const prisma = {
      boardComment: { create },
    } as unknown as PrismaService;

    const comment = await new BoardRepository(prisma).createComment({
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      body: '새 댓글',
    });

    expect(comment).toEqual({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      authorRole: Role.STUDENT,
      authorName: 'synthetic-author',
      body: '새 댓글',
      createdAt,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          author: { select: expectedCommentAuthorSelect },
        }) as unknown,
      }),
    );
  });
});
