import { act } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createListScreenRoot as createRoot,
  useTestSearchParams,
} from '../../../../test-support/list-screen-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { programFeatureKey } from '@/lib/query-keys';
import type { BoardComment, BoardPostDetail, BoardPostsPage } from '../types';

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    router: { push, refresh: vi.fn() },
    getOverview: vi.fn<() => Promise<{ boardPostCount: number }>>(),
    listBoardPosts: vi.fn(),
    getBoardPost: vi.fn(),
    createBoardPost: vi.fn(),
    updateBoardPost: vi.fn(),
    deleteBoardPost: vi.fn(),
    setBoardPostPinned: vi.fn(),
    createBoardComment: vi.fn(),
    deleteBoardComment: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: useTestSearchParams,
  usePathname: () => '/programs/program-1/board',
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
    createBoardPost: mocks.createBoardPost,
    updateBoardPost: mocks.updateBoardPost,
    deleteBoardPost: mocks.deleteBoardPost,
    setBoardPostPinned: mocks.setBoardPostPinned,
    createBoardComment: mocks.createBoardComment,
    deleteBoardComment: mocks.deleteBoardComment,
  };
});

import { BoardDetailScreen } from './board-detail-screen';
import { BoardListScreen } from './board-list-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const comment: BoardComment = {
  id: 'comment-1',
  postId: 'post-1',
  authorRole: 'STUDENT',
  authorName: '합성 댓글러',
  body: '합성 댓글 본문',
  createdAt: '2026-08-01T04:00:00.000Z',
  canDelete: true,
};

const post: BoardPostDetail = {
  id: 'post-1',
  programId: 'program-1',
  authorName: '합성 질문자',
  category: 'QNA',
  title: '처음 합성 제목',
  body: '처음 합성 본문',
  pinned: false,
  createdAt: '2026-08-01T03:00:00.000Z',
  updatedAt: '2026-08-01T03:00:00.000Z',
  commentCount: 0,
  canEdit: true,
  canDelete: true,
  comments: [],
};

function pageOf(detail: BoardPostDetail): BoardPostsPage {
  return {
    items: [
      {
        id: detail.id,
        programId: detail.programId,
        authorName: detail.authorName,
        category: detail.category,
        title: detail.title,
        pinned: detail.pinned,
        createdAt: detail.createdAt,
        commentCount: detail.commentCount,
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };
}

function OverviewProbe() {
  const overview = useQuery({
    queryKey: programFeatureKey('program-1', 'overview', false),
    queryFn: mocks.getOverview,
  });
  return <output>{`overview-count:${overview.data?.boardPostCount}`}</output>;
}

describe('게시판 변경은 쿼리 키로 목록과 메뉴 수를 갱신한다', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (vi.isMockFunction(mock)) mock.mockReset();
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.getOverview.mockResolvedValue({ boardPostCount: 1 });
    mocks.listBoardPosts.mockResolvedValue(pageOf(post));
    mocks.getBoardPost.mockResolvedValue(post);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function buttonsNamed(label: string): HTMLButtonElement[] {
    return [...container.querySelectorAll('button')].filter(
      (candidate) => candidate.textContent === label,
    );
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const [button] = buttonsNamed(label);
    if (!button) throw new TypeError(`「${label}」 버튼을 찾지 못했습니다.`);
    return button;
  }

  function control<T extends HTMLInputElement | HTMLTextAreaElement>(
    selector: string,
  ): T {
    const element = container.querySelector<T>(selector);
    if (!element) throw new TypeError(`${selector} 칸을 찾지 못했습니다.`);
    return element;
  }

  async function fill(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): Promise<void> {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function renderBoard(
    { detail, isStaff }: { detail: boolean; isStaff: boolean } = {
      detail: true,
      isStaff: false,
    },
  ): Promise<void> {
    await act(async () =>
      root.render(
        <>
          <OverviewProbe />
          <BoardListScreen programId="program-1" isStaff={isStaff} />
          {detail ? (
            <BoardDetailScreen
              programId="program-1"
              postId="post-1"
              isStaff={isStaff}
            />
          ) : null}
        </>,
      ),
    );
    expect(mocks.getOverview).toHaveBeenCalledTimes(1);
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(1);
  }

  it('글 작성이 성공하면 목록과 메뉴 수를 다시 읽고 새 글로 이동한다', async () => {
    mocks.createBoardPost.mockResolvedValue({ ...post, id: 'post-2' });
    await renderBoard({ detail: false, isStaff: false });
    mocks.getOverview.mockResolvedValue({ boardPostCount: 2 });
    await act(async () => buttonNamed('질문 쓰기').click());
    await fill(control('#board-new-post-title'), '새 합성 제목');
    await fill(control('#board-new-post-body'), '새 합성 본문');

    await act(async () => buttonNamed('올리기').click());

    expect(mocks.push).toHaveBeenCalledWith('/programs/program-1/board/post-2');
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(2);
    expect(mocks.getOverview).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('overview-count:2');
  });

  it('글 작성이 실패하면 목록과 메뉴 수를 그대로 두고 오류를 보여준다', async () => {
    mocks.createBoardPost.mockRejectedValue(new Error('synthetic failure'));
    await renderBoard({ detail: false, isStaff: false });
    await act(async () => buttonNamed('질문 쓰기').click());
    await fill(control('#board-new-post-title'), '새 합성 제목');
    await fill(control('#board-new-post-body'), '새 합성 본문');

    await act(async () => buttonNamed('올리기').click());

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(1);
    expect(mocks.getOverview).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('처음 합성 제목');
    expect(container.textContent).toContain('잠시 후 다시 시도해 주세요.');
  });

  it('글을 삭제하면 목록과 메뉴 수를 다시 읽고 지운 글 상세는 다시 읽지 않는다', async () => {
    mocks.deleteBoardPost.mockResolvedValue({ deleted: true });
    await renderBoard();
    mocks.getOverview.mockResolvedValue({ boardPostCount: 0 });

    await act(async () => buttonsNamed('삭제')[0]?.click());

    expect(mocks.push).toHaveBeenCalledWith('/programs/program-1/board');
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(2);
    expect(mocks.getOverview).toHaveBeenCalledTimes(2);
    expect(mocks.getBoardPost).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('overview-count:0');
  });

  it('글을 수정하면 상세와 목록 제목이 함께 바뀐다', async () => {
    const edited = { ...post, title: '고친 합성 제목' };
    mocks.updateBoardPost.mockResolvedValue(edited);
    await renderBoard();
    mocks.listBoardPosts.mockResolvedValue(pageOf(edited));
    mocks.getBoardPost.mockResolvedValue(edited);
    await act(async () => buttonNamed('수정').click());
    await fill(control('#board-edit-title'), edited.title);

    await act(async () => buttonNamed('저장').click());

    expect(mocks.updateBoardPost).toHaveBeenCalledWith('program-1', 'post-1', {
      title: edited.title,
      body: post.body,
    });
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(2);
    expect(mocks.getOverview).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('처음 합성 제목');
    expect(container.querySelector('#board-edit-title')).toBeNull();
  });

  it('고정을 바꾸면 목록을 다시 읽는다', async () => {
    mocks.setBoardPostPinned.mockResolvedValue({ pinned: true });
    await renderBoard({ detail: true, isStaff: true });
    mocks.listBoardPosts.mockResolvedValue(pageOf({ ...post, pinned: true }));
    mocks.getBoardPost.mockResolvedValue({ ...post, pinned: true });

    await act(async () => buttonNamed('고정').click());

    expect(mocks.setBoardPostPinned).toHaveBeenCalledWith(
      'program-1',
      'post-1',
      true,
    );
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(2);
    expect(mocks.getOverview).toHaveBeenCalledTimes(2);
    expect(buttonsNamed('고정 해제')).toHaveLength(1);
  });

  it('댓글 작성과 삭제는 상세 댓글과 목록 댓글 수를 갱신한다', async () => {
    mocks.createBoardComment.mockResolvedValue(comment);
    mocks.deleteBoardComment.mockResolvedValue({ deleted: true });
    await renderBoard();
    const withComment = { ...post, commentCount: 1, comments: [comment] };
    mocks.getBoardPost.mockResolvedValue(withComment);
    mocks.listBoardPosts.mockResolvedValue(pageOf(withComment));
    await fill(control('input[aria-label="댓글 내용"]'), comment.body);

    await act(async () => buttonNamed('댓글 달기').click());

    expect(container.textContent).toContain('합성 댓글 본문');
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(2);
    expect(mocks.getOverview).toHaveBeenCalledTimes(2);

    mocks.getBoardPost.mockResolvedValue(post);
    mocks.listBoardPosts.mockResolvedValue(pageOf(post));
    await act(async () => buttonsNamed('삭제')[1]?.click());

    expect(mocks.deleteBoardComment).toHaveBeenCalledWith(
      'program-1',
      'post-1',
      'comment-1',
    );
    expect(container.textContent).not.toContain('합성 댓글 본문');
    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(3);
    expect(mocks.getOverview).toHaveBeenCalledTimes(3);
  });

  it('고정 변경이 실패하면 상세와 목록을 그대로 두고 오류를 보여준다', async () => {
    mocks.setBoardPostPinned.mockRejectedValue(new Error('synthetic failure'));
    await renderBoard({ detail: true, isStaff: true });

    await act(async () => buttonNamed('고정').click());

    expect(mocks.listBoardPosts).toHaveBeenCalledTimes(1);
    expect(mocks.getOverview).toHaveBeenCalledTimes(1);
    expect(mocks.getBoardPost).toHaveBeenCalledTimes(1);
    expect(buttonsNamed('고정')).toHaveLength(1);
    expect(container.textContent).toContain('잠시 후 다시 시도해 주세요.');
  });
});
