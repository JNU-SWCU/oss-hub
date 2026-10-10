import { AccountStatus, BoardPostCategory } from '@prisma/client';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { DomainException } from '../../common/error-code';
import { BoardErrorCode } from '../domain/board-error-code.enum';
import { BoardRepository } from '../repository/board.repository';
import { BoardService } from './board.service';

const syntheticProgramId = 'cuid-synthetic-program';
const syntheticPostId = 'cuid-synthetic-post';
const syntheticCommentId = 'cuid-synthetic-comment';
const syntheticAuthorId = 'cuid-synthetic-author';
const syntheticOtherUserId = 'cuid-synthetic-other-user';
const syntheticStaffId = 'cuid-synthetic-staff';

const actors = new Map<
  bigint,
  {
    id: string;
    hasStaffAccess: boolean;
    hasAdminAccess: boolean;
    accountStatus: AccountStatus;
  }
>();
function sessionFor(id: string, hasStaffAccess: boolean): bigint {
  const session = BigInt(actors.size + 1);
  actors.set(session, {
    id,
    hasStaffAccess,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
  return session;
}
const authority = new UsersAuthorityService({
  findActorByGithubId: (session) =>
    Promise.resolve(actors.get(session) ?? null),
});

function syntheticPostDetail() {
  return {
    id: syntheticPostId,
    programId: syntheticProgramId,
    authorId: syntheticAuthorId,
    authorName: '합성 작성자',
    category: BoardPostCategory.QNA,
    title: '합성 제목',
    body: '합성 본문',
    pinned: false,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    commentCount: 0,
    comments: [],
  };
}

function buildRepository(overrides: Partial<BoardRepository> = {}) {
  const mocks = {
    findAccessActor: jest.fn((session: bigint) =>
      Promise.resolve(actors.get(session) ?? null),
    ),
    isApprovedParticipant: jest.fn().mockResolvedValue(true),
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
  };
  return { mocks, repository: mocks as unknown as BoardRepository };
}

describe('BoardService', () => {
  it.each(['missing', 'inactive', 'nonparticipant'] as const)(
    'rejects %s actors before post lookup',
    async (kind) => {
      const session = sessionFor(syntheticAuthorId, kind === 'inactive');
      if (kind === 'missing') actors.delete(session);
      if (kind === 'inactive')
        actors.set(session, {
          id: syntheticAuthorId,
          hasStaffAccess: true,
          hasAdminAccess: false,
          accountStatus: AccountStatus.DEACTIVATED,
        });
      const { mocks, repository } = buildRepository({
        isApprovedParticipant: jest.fn().mockResolvedValue(false),
      });
      await expect(
        new BoardService(repository, authority).getPostDetail(
          syntheticProgramId,
          syntheticPostId,
          session,
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.ACCESS_FORBIDDEN, status: 403 },
      });
      expect(mocks.findDetailById).not.toHaveBeenCalled();
      if (kind !== 'nonparticipant')
        expect(mocks.isApprovedParticipant).not.toHaveBeenCalled();
    },
  );

  describe('listPosts', () => {
    it('programId와 페이지 정보를 리포지토리에 그대로 넘기고 결과에 page/limit을 붙인다', async () => {
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
      const { mocks, repository } = buildRepository({
        findByProgramId: jest.fn().mockResolvedValue({ items, total: 1 }),
      });
      const service = new BoardService(repository, authority);

      const result = await service.listPosts(
        syntheticProgramId,
        { page: 1, limit: 20 },
        sessionFor(syntheticAuthorId, false),
      );

      expect(mocks.findByProgramId).toHaveBeenCalledWith(
        syntheticProgramId,
        1,
        20,
      );
      expect(result).toEqual({
        items: [{ ...items[0], canEdit: true, canDelete: true }],
        total: 1,
        page: 1,
        limit: 20,
      });
    });
  });

  describe('getPostDetail', () => {
    it('글이 없으면 POST_NOT_FOUND를 던진다', async () => {
      const { repository } = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(null),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.getPostDetail(
          syntheticProgramId,
          syntheticPostId,
          sessionFor(syntheticAuthorId, false),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.POST_NOT_FOUND },
      });
    });

    it('다른 프로그램 소속 글이면 404로 감춘다', async () => {
      const { repository } = buildRepository({
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
      const service = new BoardService(repository, authority);

      await expect(
        service.getPostDetail(
          syntheticProgramId,
          syntheticPostId,
          sessionFor(syntheticAuthorId, false),
        ),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('같은 프로그램 소속 글이면 그대로 반환한다', async () => {
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
      const { repository } = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(post),
      });
      const service = new BoardService(repository, authority);

      const result = await service.getPostDetail(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticAuthorId, false),
      );

      expect(result).toEqual({ ...post, canEdit: true, canDelete: true });
    });
  });

  describe('응답 권한 필드', () => {
    const post = {
      id: syntheticPostId,
      programId: syntheticProgramId,
      authorId: syntheticAuthorId,
      authorName: '합성 작성자',
      category: BoardPostCategory.QNA,
      title: '합성 질문',
      body: '합성 본문',
      pinned: false,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      commentCount: 2,
      comments: [
        {
          id: syntheticCommentId,
          postId: syntheticPostId,
          authorId: syntheticOtherUserId,
          authorRole: 'STUDENT' as const,
          authorName: '합성 댓글 작성자',
          body: '합성 댓글',
          createdAt: new Date('2026-07-01T01:00:00.000Z'),
        },
        {
          id: 'cuid-synthetic-other-comment',
          postId: syntheticPostId,
          authorId: 'cuid-synthetic-third-user',
          authorRole: 'STUDENT' as const,
          authorName: '합성 다른 댓글 작성자',
          body: '합성 다른 댓글',
          createdAt: new Date('2026-07-01T02:00:00.000Z'),
        },
      ],
    };

    it('작성자는 자기 글을 수정·삭제할 수 있고 타인 댓글은 삭제할 수 없다', async () => {
      const { repository } = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(post),
      });

      const result = await new BoardService(
        repository,
        authority,
      ).getPostDetail(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticAuthorId, false),
      );

      expect(result).toMatchObject({ canEdit: true, canDelete: true });
      expect(result.comments[0]).toMatchObject({ canDelete: false });
    });

    it('댓글 작성자는 글 권한 없이 자기 댓글만 삭제할 수 있다', async () => {
      const { repository } = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(post),
      });

      const result = await new BoardService(
        repository,
        authority,
      ).getPostDetail(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticOtherUserId, false),
      );

      expect(result).toMatchObject({ canEdit: false, canDelete: false });
      expect(result.comments).toEqual([
        expect.objectContaining({
          authorId: syntheticOtherUserId,
          canDelete: true,
        }),
        expect.objectContaining({
          authorId: 'cuid-synthetic-third-user',
          canDelete: false,
        }),
      ]);
    });

    it('교직원은 타인 글·댓글을 삭제할 수 있지만 타인 글을 수정할 수 없다', async () => {
      const { repository } = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(post),
      });

      const result = await new BoardService(
        repository,
        authority,
      ).getPostDetail(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticStaffId, true),
      );

      expect(result).toMatchObject({ canEdit: false, canDelete: true });
      expect(result.comments).toEqual([
        expect.objectContaining({ canDelete: true }),
        expect.objectContaining({ canDelete: true }),
      ]);
    });

    it('제3자는 타인 글을 수정·삭제할 수 없고 타인 댓글도 삭제할 수 없다', async () => {
      const { repository } = buildRepository({
        findDetailById: jest.fn().mockResolvedValue(post),
      });

      const result = await new BoardService(
        repository,
        authority,
      ).getPostDetail(
        syntheticProgramId,
        syntheticPostId,
        sessionFor('cuid-synthetic-unrelated-user', false),
      );

      expect(result).toMatchObject({ canEdit: false, canDelete: false });
      expect(result.comments).toEqual([
        expect.objectContaining({ canDelete: false }),
        expect.objectContaining({ canDelete: false }),
      ]);
    });
  });

  describe('createPost', () => {
    it('교직원이 쓰면 NOTICE로 만든다', async () => {
      const { mocks, repository } = buildRepository({
        create: jest.fn().mockResolvedValue(syntheticPostDetail()),
      });
      const service = new BoardService(repository, authority);

      await service.createPost(
        syntheticProgramId,
        sessionFor(syntheticStaffId, true),
        {
          title: '공지 제목',
          body: '공지 본문',
        },
      );

      expect(mocks.create).toHaveBeenCalledWith({
        programId: syntheticProgramId,
        authorId: syntheticStaffId,
        category: BoardPostCategory.NOTICE,
        title: '공지 제목',
        body: '공지 본문',
      });
    });

    it('학생이 쓰면 QNA로 만든다', async () => {
      const { mocks, repository } = buildRepository({
        create: jest.fn().mockResolvedValue(syntheticPostDetail()),
      });
      const service = new BoardService(repository, authority);

      await service.createPost(
        syntheticProgramId,
        sessionFor(syntheticAuthorId, false),
        {
          title: '질문 제목',
          body: '질문 본문',
        },
      );

      expect(mocks.create).toHaveBeenCalledWith({
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
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
        update: jest.fn().mockResolvedValue(syntheticPostDetail()),
      });
      const service = new BoardService(repository, authority);

      await service.updatePost(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticAuthorId, false),
        { title: '새 제목', body: '새 본문' },
      );

      expect(mocks.update).toHaveBeenCalledWith(syntheticPostId, {
        title: '새 제목',
        body: '새 본문',
      });
    });

    it('작성자가 아니면 교직원이어도 NOT_AUTHOR를 던진다', async () => {
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.updatePost(
          syntheticProgramId,
          syntheticPostId,
          sessionFor(syntheticStaffId, false),
          { title: '새 제목', body: '새 본문' },
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.NOT_AUTHOR },
      });
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('다른 프로그램 소속 글이면 POST_NOT_FOUND를 던진다', async () => {
      const { repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue(null),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.updatePost(
          syntheticProgramId,
          syntheticPostId,
          sessionFor(syntheticAuthorId, false),
          { title: '새 제목', body: '새 본문' },
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.POST_NOT_FOUND },
      });
    });
  });

  describe('deletePost', () => {
    it('작성자 본인이면 지운다', async () => {
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository, authority);

      await service.deletePost(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticAuthorId, false),
      );

      expect(mocks.deleteWithComments).toHaveBeenCalledWith(syntheticPostId);
    });

    it('작성자가 아니어도 교직원이면 지운다', async () => {
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository, authority);

      await service.deletePost(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticStaffId, true),
      );

      expect(mocks.deleteWithComments).toHaveBeenCalledWith(syntheticPostId);
    });

    it('작성자도 교직원도 아니면 NOT_AUTHOR를 던진다', async () => {
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.deletePost(
          syntheticProgramId,
          syntheticPostId,
          sessionFor(syntheticOtherUserId, false),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.NOT_AUTHOR },
      });
      expect(mocks.deleteWithComments).not.toHaveBeenCalled();
    });
  });

  describe('setPinned', () => {
    it('교직원이면 고정 상태를 바꾼다', async () => {
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
      });
      const service = new BoardService(repository, authority);

      await service.setPinned(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticStaffId, true),
        true,
      );

      expect(mocks.setPinned).toHaveBeenCalledWith(syntheticPostId, true);
    });

    it('교직원이 아니면 STAFF_ONLY를 던지고 리포지토리를 건드리지 않는다', async () => {
      const { mocks, repository } = buildRepository();
      const service = new BoardService(repository, authority);

      await expect(
        service.setPinned(
          syntheticProgramId,
          syntheticPostId,
          sessionFor(syntheticStaffId, false),
          true,
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.STAFF_ONLY },
      });
      expect(mocks.findRefById).not.toHaveBeenCalled();
      expect(mocks.setPinned).not.toHaveBeenCalled();
    });
  });

  describe('createComment', () => {
    it('글이 프로그램 소속이면 댓글을 만든다', async () => {
      const { mocks, repository } = buildRepository({
        findRefById: jest.fn().mockResolvedValue({
          id: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticAuthorId,
        }),
        createComment: jest.fn().mockResolvedValue({}),
      });
      const service = new BoardService(repository, authority);

      await service.createComment(
        syntheticProgramId,
        syntheticPostId,
        sessionFor(syntheticOtherUserId, false),
        { body: '댓글 내용' },
      );

      expect(mocks.createComment).toHaveBeenCalledWith({
        postId: syntheticPostId,
        authorId: syntheticOtherUserId,
        body: '댓글 내용',
      });
    });
  });

  describe('deleteComment', () => {
    it('작성자 본인이면 지운다', async () => {
      const { mocks, repository } = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository, authority);

      await service.deleteComment(
        syntheticProgramId,
        syntheticPostId,
        syntheticCommentId,
        sessionFor(syntheticOtherUserId, false),
      );

      expect(mocks.deleteComment).toHaveBeenCalledWith(syntheticCommentId);
    });

    it('작성자가 아니어도 교직원이면 지운다', async () => {
      const { mocks, repository } = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository, authority);

      await service.deleteComment(
        syntheticProgramId,
        syntheticPostId,
        syntheticCommentId,
        sessionFor(syntheticStaffId, true),
      );

      expect(mocks.deleteComment).toHaveBeenCalledWith(syntheticCommentId);
    });

    it('작성자도 교직원도 아니면 NOT_AUTHOR를 던진다', async () => {
      const { mocks, repository } = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: syntheticPostId,
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.deleteComment(
          syntheticProgramId,
          syntheticPostId,
          syntheticCommentId,
          sessionFor(syntheticAuthorId, false),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.NOT_AUTHOR },
      });
      expect(mocks.deleteComment).not.toHaveBeenCalled();
    });

    it('다른 글/프로그램 소속 댓글이면 COMMENT_NOT_FOUND를 던진다', async () => {
      const { repository } = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue({
          id: syntheticCommentId,
          postId: 'cuid-synthetic-other-post',
          programId: syntheticProgramId,
          authorId: syntheticOtherUserId,
        }),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.deleteComment(
          syntheticProgramId,
          syntheticPostId,
          syntheticCommentId,
          sessionFor(syntheticOtherUserId, false),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.COMMENT_NOT_FOUND },
      });
    });

    it('댓글이 없으면 COMMENT_NOT_FOUND를 던진다', async () => {
      const { repository } = buildRepository({
        findCommentRefById: jest.fn().mockResolvedValue(null),
      });
      const service = new BoardService(repository, authority);

      await expect(
        service.deleteComment(
          syntheticProgramId,
          syntheticPostId,
          syntheticCommentId,
          sessionFor(syntheticOtherUserId, false),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: BoardErrorCode.COMMENT_NOT_FOUND },
      });
    });
  });
});
