// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPostDetail, BoardPostsPage } from '../types';

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    router: { push, refresh: vi.fn() },
    listBoardPosts: vi.fn(),
    getBoardPost: vi.fn(),
    createBoardPost: vi.fn(),
    updateBoardPost: vi.fn(),
    createBoardComment: vi.fn(),
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
    createBoardPost: mocks.createBoardPost,
    updateBoardPost: mocks.updateBoardPost,
    createBoardComment: mocks.createBoardComment,
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
  authorName: '합성 질문자',
  category: 'QNA',
  title: '제출 마감일 문의드립니다',
  body: '중간 산출물 마감일이 정확히 언제인가요?',
  pinned: false,
  createdAt: '2026-08-01T03:00:00.000Z',
  updatedAt: '2026-08-01T03:00:00.000Z',
  commentCount: 0,
  canEdit: true,
  canDelete: true,
  comments: [],
};

const emptyPage: BoardPostsPage = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
};

describe('게시판 폼의 첫 오류 칸으로 초점 이동', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (vi.isMockFunction(mock)) mock.mockReset();
    }
    mocks.listBoardPosts.mockResolvedValue(emptyPage);
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

  function buttonNamed(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label,
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new TypeError(`「${label}」 버튼을 찾지 못했습니다.`);
    }
    return button;
  }

  function control<T extends HTMLElement>(selector: string): T {
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
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    await act(async () => {
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function renderList(): Promise<void> {
    await act(async () => {
      root.render(<BoardListView programId="program-1" isStaff={false} />);
    });
    await act(async () => buttonNamed('질문 쓰기').click());
  }

  async function renderDetail(): Promise<void> {
    await act(async () => {
      root.render(
        <BoardDetailView
          programId="program-1"
          postId="post-1"
          isStaff={false}
        />,
      );
    });
  }

  it('제목·내용을 비우고 「올리기」를 누르면 제목 칸에서 커서가 깜박인다', async () => {
    await renderList();

    await act(async () => buttonNamed('올리기').click());

    expect(document.activeElement).toBe(control('#board-new-post-title'));
    expect(mocks.createBoardPost).not.toHaveBeenCalled();
  });

  it('제목만 채우고 누르면 내용 칸으로 커서가 옮겨간다', async () => {
    await renderList();
    await fill(control<HTMLInputElement>('#board-new-post-title'), '제목 초안');

    await act(async () => buttonNamed('올리기').click());

    expect(document.activeElement).toBe(control('#board-new-post-body'));
  });

  // 「한 번 제출한 뒤부터 입력값으로 다시 판정」 — 가입 프로필·설정 폼과 같은 방식이다.
  it('한 번 누른 뒤에는 그 칸을 채우면 다시 누르지 않아도 오류가 사라진다', async () => {
    await renderList();
    await act(async () => buttonNamed('올리기').click());
    expect(container.textContent).toContain('제목을 입력해 주세요.');

    await fill(control<HTMLInputElement>('#board-new-post-title'), '제목 초안');

    expect(container.textContent).not.toContain('제목을 입력해 주세요.');
    // 아직 비어 있는 내용 칸의 오류는 그대로 남는다.
    expect(container.textContent).toContain('내용을 입력해 주세요.');
  });

  it('수정에서 내용을 지우고 「저장」을 누르면 내용 칸으로 커서가 옮겨간다', async () => {
    await renderDetail();
    await act(async () => buttonNamed('수정').click());
    await fill(control<HTMLTextAreaElement>('#board-edit-body'), '   ');

    await act(async () => buttonNamed('저장').click());

    expect(document.activeElement).toBe(control('#board-edit-body'));
    expect(mocks.updateBoardPost).not.toHaveBeenCalled();
  });

  it('빈 댓글로 「댓글 달기」를 누르면 댓글 칸으로 커서가 옮겨간다', async () => {
    await renderDetail();

    await act(async () => buttonNamed('댓글 달기').click());

    expect(document.activeElement).toBe(
      control('input[aria-label="댓글 내용"]'),
    );
    expect(mocks.createBoardComment).not.toHaveBeenCalled();
  });
});
