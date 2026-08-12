// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPostDetail, BoardPostsPage } from '../types';

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  const refresh = vi.fn();
  return {
    push,
    refresh,
    router: { push, refresh },
    listBoardPosts: vi.fn(),
    getBoardPost: vi.fn(),
    deleteBoardPost: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    listBoardPosts: mocks.listBoardPosts,
    getBoardPost: mocks.getBoardPost,
    deleteBoardPost: mocks.deleteBoardPost,
  };
});

import { BoardDetailView } from './board-detail-view';
import { BoardListView } from './board-list-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const post: BoardPostDetail = {
  id: 'post-1',
  programId: 'program-1',
  authorId: 'user-1',
  authorName: '합성 질문자',
  category: 'QNA',
  title: '삭제할 합성 질문',
  body: '삭제 뒤 목록 재조회를 검증합니다.',
  pinned: false,
  createdAt: '2026-08-01T03:00:00.000Z',
  updatedAt: '2026-08-01T03:00:00.000Z',
  commentCount: 0,
  comments: [],
};

const pageWithPost: BoardPostsPage = {
  items: [
    {
      id: post.id,
      programId: post.programId,
      authorId: post.authorId,
      authorName: post.authorName,
      category: post.category,
      title: post.title,
      pinned: post.pinned,
      createdAt: post.createdAt,
      commentCount: post.commentCount,
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
};

const emptyPage: BoardPostsPage = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
};

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new TypeError('resolver is unavailable');
      resolvePromise(value);
    },
    reject(reason: unknown): void {
      if (!rejectPromise) throw new TypeError('rejecter is unavailable');
      rejectPromise(reason);
    },
  };
}

describe('게시글 삭제 후 목록 복귀', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    mocks.listBoardPosts.mockReset();
    mocks.getBoardPost.mockReset();
    mocks.deleteBoardPost.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('삭제 성공 시 캐시된 목록을 다시 조회해 삭제된 글과 총 개수를 즉시 갱신한다', async () => {
    const initialList = deferred<BoardPostsPage>();
    const refreshedList = deferred<BoardPostsPage>();
    const detail = deferred<BoardPostDetail>();
    const deletion = deferred<{ readonly deleted: true }>();
    mocks.listBoardPosts
      .mockReturnValueOnce(initialList.promise)
      .mockReturnValueOnce(refreshedList.promise);
    mocks.getBoardPost.mockReturnValue(detail.promise);
    mocks.deleteBoardPost.mockReturnValue(deletion.promise);

    await act(async () => {
      root.render(
        <>
          <BoardListView programId="program-1" isStaff={false} />
          <BoardDetailView
            programId="program-1"
            postId="post-1"
            isStaff={false}
          />
        </>,
      );
    });
    expect(mocks.listBoardPosts).toHaveBeenCalledOnce();

    await act(async () => {
      initialList.resolve(pageWithPost);
      detail.resolve(post);
      await Promise.all([initialList.promise, detail.promise]);
    });
    expect(container.textContent).toContain('삭제할 합성 질문');

    const deleteButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '삭제',
    );
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new TypeError('게시글 삭제 버튼을 찾지 못했습니다.');
    }
    await act(async () => {
      deleteButton.click();
    });
    expect(mocks.deleteBoardPost).toHaveBeenCalledWith('program-1', 'post-1');

    await act(async () => {
      deletion.resolve({ deleted: true });
      await deletion.promise;
    });

    expect(mocks.push).toHaveBeenCalledWith('/programs/program-1/board');
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(2);

    await act(async () => {
      refreshedList.resolve(emptyPage);
      await refreshedList.promise;
    });
    expect(container.textContent).toContain('아직 등록된 글이 없습니다');
  });

  it('삭제 API가 실패하면 목록 상태와 현재 화면을 그대로 유지한다', async () => {
    const initialList = deferred<BoardPostsPage>();
    const detail = deferred<BoardPostDetail>();
    const deletion = deferred<{ readonly deleted: true }>();
    mocks.listBoardPosts.mockReturnValue(initialList.promise);
    mocks.getBoardPost.mockReturnValue(detail.promise);
    mocks.deleteBoardPost.mockReturnValue(deletion.promise);

    await act(async () => {
      root.render(
        <>
          <BoardListView programId="program-1" isStaff={false} />
          <BoardDetailView
            programId="program-1"
            postId="post-1"
            isStaff={false}
          />
        </>,
      );
    });
    await act(async () => {
      initialList.resolve(pageWithPost);
      detail.resolve(post);
      await Promise.all([initialList.promise, detail.promise]);
    });

    const deleteButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '삭제',
    );
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new TypeError('게시글 삭제 버튼을 찾지 못했습니다.');
    }
    await act(async () => {
      deleteButton.click();
    });
    const deletionSettled = deletion.promise.catch(() => undefined);
    await act(async () => {
      deletion.reject(new Error('synthetic forbidden'));
      await deletionSettled;
    });

    expect(mocks.listBoardPosts).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('삭제할 합성 질문');
    expect(container.textContent).toContain('잠시 후 다시 시도해 주세요.');
  });
});
