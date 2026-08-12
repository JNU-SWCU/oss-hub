import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BoardListContent,
  type BoardListContentProps,
} from './board-list-view';
import type { BoardPostSummary } from '../types';

const posts: readonly BoardPostSummary[] = [
  {
    id: 'post-1',
    programId: 'program-1',
    authorId: 'user-1',
    authorName: '합성 운영자',
    category: 'NOTICE',
    title: '1차 중간 산출물 제출 안내',
    pinned: true,
    createdAt: '2026-08-01T03:00:00.000Z',
    commentCount: 2,
  },
  {
    id: 'post-2',
    programId: 'program-1',
    authorId: 'user-2',
    authorName: '합성 질문자',
    category: 'QNA',
    title: '제출 마감일 문의드립니다',
    pinned: false,
    createdAt: '2026-08-02T03:00:00.000Z',
    commentCount: 0,
  },
];

function baseProps(
  overrides: Partial<BoardListContentProps> = {},
): BoardListContentProps {
  return {
    programId: 'program-1',
    isStaff: false,
    state: { kind: 'loading' },
    page: 1,
    newPostOpen: false,
    newPostTitle: '',
    newPostBody: '',
    newPostSubmitting: false,
    newPostError: null,
    onToggleNewPost: () => {},
    onTitleChange: () => {},
    onBodyChange: () => {},
    onSubmitNewPost: () => {},
    onPageChange: () => {},
    onRetry: () => {},
    ...overrides,
  };
}

describe('BoardListContent', () => {
  it('제목·안내 문구를 렌더한다(학생 뷰)', () => {
    const html = renderToStaticMarkup(<BoardListContent {...baseProps()} />);
    expect(html).toContain('게시판');
    expect(html).toContain('교직원 공지와 질문 글입니다');
    expect(html).toContain('질문 쓰기');
  });

  it('교직원 뷰는 공지 쓰기 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent {...baseProps({ isStaff: true })} />,
    );
    expect(html).toContain('공지 쓰기');
    expect(html).not.toContain('질문 쓰기');
  });

  it('로딩 중에는 로딩 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent {...baseProps({ state: { kind: 'loading' } })} />,
    );
    expect(html).toContain('게시판을 불러오는 중');
  });

  it('에러 상태는 안내와 다시 시도 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          state: { kind: 'error', message: '문제가 발생했습니다.' },
        })}
      />,
    );
    expect(html).toContain('게시판을 불러오지 못했습니다');
    expect(html).toContain('문제가 발생했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('글이 없으면 빈 상태 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          state: {
            kind: 'ready',
            page: { items: [], total: 0, page: 1, limit: 20 },
          },
        })}
      />,
    );
    expect(html).toContain('아직 등록된 글이 없습니다');
    expect(html).toContain('첫 글을 남겨 보세요.');
  });

  it('고정글·일반글 목록을 구분·작성자·작성일·댓글수와 함께 렌더한다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          state: {
            kind: 'ready',
            page: { items: posts, total: 2, page: 1, limit: 20 },
          },
        })}
      />,
    );
    // 정보 구조: 공지/질문이 한 목록, 제목·작성자·작성일·댓글 수
    expect(html).toContain('1차 중간 산출물 제출 안내');
    expect(html).toContain('제출 마감일 문의드립니다');
    expect(html).toContain('공지');
    expect(html).toContain('질문');
    expect(html).toContain('구분');
    expect(html).toContain('제목');
    expect(html).toContain('작성자');
    expect(html).toContain('작성일');
    expect(html).toContain('댓글');
    expect(html).toContain('합성 운영자');
    expect(html).toContain('합성 질문자');
    expect(html).toContain('교직원');
    expect(html).toContain('학생');
    expect(html).toContain('고정된 글');
    expect(html).toContain('/programs/program-1/board/post-1');
    expect(html).toContain('/programs/program-1/board/post-2');
  });

  it('새 글 작성 폼이 열리면 입력 필드와 버튼을 렌더한다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          newPostOpen: true,
          newPostTitle: '제목 초안',
          newPostBody: '내용 초안',
        })}
      />,
    );
    expect(html).toContain('제목 초안');
    expect(html).toContain('내용 초안');
    expect(html).toContain('올리기');
    expect(html).toContain('취소');
  });

  it('새 글 작성 중 에러 메시지를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          newPostOpen: true,
          newPostError: '제목을 입력해 주세요.',
        })}
      />,
    );
    expect(html).toContain('제목을 입력해 주세요.');
  });

  it('총 개수가 페이지 크기를 넘으면 페이지네이션을 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          page: 2,
          state: {
            kind: 'ready',
            page: { items: posts, total: 45, page: 2, limit: 20 },
          },
        })}
      />,
    );
    expect(html).toContain('게시판 페이지');
    expect(html).toContain('2 / 3');
  });
});
