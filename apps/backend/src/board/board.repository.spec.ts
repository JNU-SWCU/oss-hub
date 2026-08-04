import { BoardPostCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BoardRepository } from './board.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticPostId = 'cuid-synthetic-post';
const syntheticCommentId = 'cuid-synthetic-comment';
const syntheticAuthorId = 'cuid-synthetic-author';

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
