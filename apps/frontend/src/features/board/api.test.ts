import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';

import {
  createBoardComment,
  createBoardPost,
  deleteBoardComment,
  deleteBoardPost,
  getBoardPost,
  listBoardPosts,
  setBoardPostPinned,
  updateBoardPost,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJsonResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('board api', () => {
  it('페이지 파라미터 없이 목록을 조회한다', async () => {
    // Given
    const response = { items: [], total: 0, page: 1, limit: 20 };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await listBoardPosts('program-1');

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts'),
      undefined,
    );
  });

  it('page·limit을 쿼리로 실어 목록을 조회한다', async () => {
    // Given
    const response = { items: [], total: 0, page: 2, limit: 10 };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await listBoardPosts('program-1', { page: 2, limit: 10 });

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts?page=2&limit=10'),
      undefined,
    );
  });

  it('programId를 인코딩해 게시글 상세를 조회한다', async () => {
    // Given
    const response = {
      id: 'post-1',
      programId: 'program:1',
      category: 'NOTICE',
      title: '제목',
      body: '본문',
      pinned: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      commentCount: 0,
      comments: [],
    };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await getBoardPost('program:1', 'post-1');

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program%3A1/board/posts/post-1'),
      undefined,
    );
  });

  it('게시글을 작성한다', async () => {
    // Given
    const response = {
      id: 'post-2',
      programId: 'program-1',
      category: 'QNA',
      title: '질문 있습니다',
      body: '본문 내용',
      pinned: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      commentCount: 0,
      comments: [],
    };
    const fetchMock = mockJsonResponse(response, 201);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await createBoardPost('program-1', {
      title: '질문 있습니다',
      body: '본문 내용',
    });

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '질문 있습니다', body: '본문 내용' }),
      },
    );
  });

  it('게시글을 수정한다', async () => {
    // Given
    const response = {
      id: 'post-1',
      programId: 'program-1',
      category: 'NOTICE',
      title: '수정된 제목',
      body: '수정된 본문',
      pinned: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      commentCount: 0,
      comments: [],
    };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await updateBoardPost('program-1', 'post-1', {
      title: '수정된 제목',
      body: '수정된 본문',
    });

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts/post-1'),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '수정된 제목', body: '수정된 본문' }),
      },
    );
  });

  it('게시글을 삭제한다', async () => {
    // Given
    const response = { deleted: true };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await deleteBoardPost('program-1', 'post-1');

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts/post-1'),
      { method: 'DELETE' },
    );
  });

  it('게시글 고정 여부를 바꾼다', async () => {
    // Given
    const response = { pinned: true };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await setBoardPostPinned('program-1', 'post-1', true);

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts/post-1/pin'),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      },
    );
  });

  it('댓글을 작성한다', async () => {
    // Given
    const response = {
      id: 'comment-1',
      postId: 'post-1',
      authorRole: 'STAFF',
      body: '댓글 내용',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    const fetchMock = mockJsonResponse(response, 201);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await createBoardComment('program-1', 'post-1', {
      body: '댓글 내용',
    });

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts/post-1/comments'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '댓글 내용' }),
      },
    );
  });

  it('댓글을 삭제한다', async () => {
    // Given
    const response = { deleted: true };
    const fetchMock = mockJsonResponse(response);
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await deleteBoardComment('program-1', 'post-1', 'comment-1');

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/board/posts/post-1/comments/comment-1'),
      { method: 'DELETE' },
    );
  });
});
