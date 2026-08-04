import { BoardPostCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { BoardErrorCode } from './board-error-code.enum';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticPostId = 'cuid-synthetic-post';
const syntheticCommentId = 'cuid-synthetic-comment';
const syntheticAuthorId = 'cuid-synthetic-author';
const syntheticOtherUserId = 'cuid-synthetic-other-user';
const syntheticStaffId = 'cuid-synthetic-staff';

function buildRepository(overrides: Partial<BoardRepository> = {}) {
  return {
    findByProgramId: jest.fn(),
    findDetailById: jest.fn(),
    findRefById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteWithComments: jest.fn(),
    setPinned: jest.fn(),
    createComment: jest.fn(),
    findCommentRefById: jest.fn(),
    deleteComment: jest.fn(),
    ...overrides,
  } as unknown as BoardRepository;
}

describe('BoardService', () => {
  describe('listPosts', () => {
    it('programId와 페이지 정보를 리포지토리에 그대로 넘기고 결과에 page/limit을 붙인다', async () => {
      // Given
      const items = [
        {
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
          category: BoardPostCategory.NOTICE,
          title: '합성 공지 제목',
          pinned: true,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          commentCount: 2,
        },
      ];
      const repository = buildRepository({
        findByProgramId: jest.fn().mockResolvedValue({ items, total: 1 }),
      });
      const service = new BoardService(repository);

      // When
      const result = await service.listPosts(syntheticProgramId, {
        page: 1,
        limit: 20,
      });

      // Then
      expect(repository.findByProgramId).toHaveBeenCalledWith(
        syntheticProgramId,
        1,
        20,
      );
      expect(result).toEqual({ items, total: 1, page: 1, limit: 20 });
    });
  });

  describe('getPostDetail', () => {
    it('글이 없으면 POST_NOT_FOUND를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(null),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.getPostDetail(syntheticProgramId, syntheticPostId),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.POST_NOT_FOUND,
        }),
      });
    });

    it('다른 프로그램 소속 글이면 404로 감춘다', async () => {
      // Given
      const repository = buildRepository({
        findDetailById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: 'cuid-synthetic-other-program',
          authorId: syntheticAuthorId,
          category: BoardPostCategory.QNA,
          title: '제목',
          body: '본문',
          pinned: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          commentCount: 0,
          comments: [],
        }),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.getPostDetail(syntheticProgramId, syntheticPostId),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('같은 프로그램 소속 글이면 그대로 반환한다', async () => {
      // Given
      const post = {
        id: syntheticPostId,
        programId: syntheticProgramId,
        authorId: syntheticAuthorId,
        category: BoardPostCategory.QNA,
        title: '제목',
        body: '본문',
        pinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        commentCount: 0,
        comments: [],
      };
      const repository = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(post),
      });
      const service = new BoardService(repository);

      // When
      const result = await service.getPostDetail(
        syntheticProgramId,
        syntheticPostId,
      );

      // Then
      expect(result).toBe(post);
    });
  });

  describe('createPost', () => {
    it('교직원이 쓰면 NOTICE로 만든다', async () => {
      // Given
      const repository = buildRepository({
        create: jest.fn().mockResolvedValue({}),
      });
      const service = new BoardService(repository);

      // When
      await service.createPost(syntheticProgramId, syntheticStaffId, true, {
        title: '공지 제목',
        body: '공지 본문',
      });

      // Then
      expect(repository.create).toHaveBeenCalledWith({
        programId: syntheticProgramId,
        authorId: syntheticStaffId,
        category: BoardPostCategory.NOTICE,
        title: '공지 제목',
        body: '공지 본문',
      });
    });

    it('학생이 쓰면 QNA로 만든다', async () => {
      // Given
      const repository = buildRepository({
        create: jest.fn().mockResolvedValue({}),
      });
      const service = new BoardService(repository);

      // When
      await service.createPost(syntheticProgramId, syntheticAuthorId, false, {
        title: '질문 제목',
        body: '질문 본문',
      });

      // Then
      expect(repository.create).toHaveBeenCalledWith({
        programId: syntheticProgramId,
        authorId: syntheticAuthorId,
        category: BoardPostCategory.QNA,
        title: '질문 제목',
        body: '질문 본문',
      });
    });
  });

  describe('updatePost', () => {
    it('작성자 본인이면 수정한다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
        update: jest.fn().mockResolvedValue({}),
      });
      const service = new BoardService(repository);

      // When
      await service.updatePost(
        syntheticProgramId,
        syntheticPostId,
        syntheticAuthorId,
        { title: '새 제목', body: '새 본문' },
      );

      // Then
      expect(repository.update).toHaveBeenCalledWith(syntheticPostId, {
        title: '새 제목',
        body: '새 본문',
      });
    });

    it('작성자가 아니면 교직원이어도 NOT_AUTHOR를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.updatePost(
          syntheticProgramId,
          syntheticPostId,
          syntheticStaffId,
          { title: '새 제목', body: '새 본문' },
        ),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.NOT_AUTHOR,
        }),
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('다른 프로그램 소속 글이면 POST_NOT_FOUND를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue(null),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.updatePost(
          syntheticProgramId,
          syntheticPostId,
          syntheticAuthorId,
          { title: '새 제목', body: '새 본문' },
        ),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.POST_NOT_FOUND,
        }),
      });
    });
  });

  describe('deletePost', () => {
    it('작성자 본인이면 지운다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository);

      // When
      await service.deletePost(
        syntheticProgramId,
        syntheticPostId,
        syntheticAuthorId,
        false,
      );

      // Then
      expect(repository.deleteWithComments).toHaveBeenCalledWith(
        syntheticPostId,
      );
    });

    it('작성자가 아니어도 교직원이면 지운다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository);

      // When
      await service.deletePost(
        syntheticProgramId,
        syntheticPostId,
        syntheticStaffId,
        true,
      );

      // Then
      expect(repository.deleteWithComments).toHaveBeenCalledWith(
        syntheticPostId,
      );
    });

    it('작성자도 교직원도 아니면 NOT_AUTHOR를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.deletePost(
          syntheticProgramId,
          syntheticPostId,
          syntheticOtherUserId,
          false,
        ),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.NOT_AUTHOR,
        }),
      });
      expect(repository.deleteWithComments).not.toHaveBeenCalled();
    });
  });

  describe('setPinned', () => {
    it('교직원이면 고정 상태를 바꾼다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository);

      // When
      await service.setPinned(syntheticProgramId, syntheticPostId, true, true);

      // Then
      expect(repository.setPinned).toHaveBeenCalledWith(syntheticPostId, true);
    });

    it('교직원이 아니면 STAFF_ONLY를 던지고 리포지토리를 건드리지 않는다', async () => {
      // Given
      const repository = buildRepository();
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.setPinned(syntheticProgramId, syntheticPostId, false, true),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.STAFF_ONLY,
        }),
      });
      expect(repository.findRefById).not.toHaveBeenCalled();
      expect(repository.setPinned).not.toHaveBeenCalled();
    });
  });

  describe('createComment', () => {
    it('글이 프로그램 소속이면 댓글을 만든다', async () => {
      // Given
      const repository = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
        createComment: jest.fn().mockResolvedValue({}),
      });
      const service = new BoardService(repository);

      // When
      await service.createComment(
        syntheticProgramId,
        syntheticPostId,
        syntheticOtherUserId,
        { body: '댓글 내용' },
      );

      // Then
      expect(repository.createComment).toHaveBeenCalledWith({
        postId: syntheticPostId,
        authorId: syntheticOtherUserId,
        body: '댓글 내용',
      });
    });
  });

  describe('deleteComment', () => {
    it('작성자 본인이면 지운다', async () => {
      // Given
      const repository = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository);

      // When
      await service.deleteComment(
        syntheticProgramId,
        syntheticPostId,
        syntheticCommentId,
        syntheticOtherUserId,
        false,
      );

      // Then
      expect(repository.deleteComment).toHaveBeenCalledWith(syntheticCommentId);
    });

    it('작성자가 아니어도 교직원이면 지운다', async () => {
      // Given
      const repository = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository);

      // When
      await service.deleteComment(
        syntheticProgramId,
        syntheticPostId,
        syntheticCommentId,
        syntheticStaffId,
        true,
      );

      // Then
      expect(repository.deleteComment).toHaveBeenCalledWith(syntheticCommentId);
    });

    it('작성자도 교직원도 아니면 NOT_AUTHOR를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.deleteComment(
          syntheticProgramId,
          syntheticPostId,
          syntheticCommentId,
          syntheticAuthorId,
          false,
        ),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.NOT_AUTHOR,
        }),
      });
      expect(repository.deleteComment).not.toHaveBeenCalled();
    });

    it('다른 글/프로그램 소속 댓글이면 COMMENT_NOT_FOUND를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: 'cuid-synthetic-other-post',
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.deleteComment(
          syntheticProgramId,
          syntheticPostId,
          syntheticCommentId,
          syntheticOtherUserId,
          false,
        ),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.COMMENT_NOT_FOUND,
        }),
      });
    });

    it('댓글이 없으면 COMMENT_NOT_FOUND를 던진다', async () => {
      // Given
      const repository = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue(null),
      });
      const service = new BoardService(repository);

      // When / Then
      await expect(
        service.deleteComment(
          syntheticProgramId,
          syntheticPostId,
          syntheticCommentId,
          syntheticOtherUserId,
          false,
        ),
      ).rejects.toMatchObject({
        errorCode: expect.objectContaining({
          code: BoardErrorCode.COMMENT_NOT_FOUND,
        }),
      });
    });
  });
});
