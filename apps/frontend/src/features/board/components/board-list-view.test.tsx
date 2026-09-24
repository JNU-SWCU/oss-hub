import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BoardListContent,
  type BoardListContentProps,
} from './board-list-view';
import { openingTag, textOf } from './field-error-test-support';
import type { BoardPostSummary } from '../types';

const posts: readonly BoardPostSummary[] = [
  {
    id: 'post-1',
    programId: 'program-1',
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
    newPostErrors: { title: null, body: null },
    newPostShowFieldErrors: false,
    newPostSubmitError: null,
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
    expect(html).toContain('프로그램 공지와 질문');
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

  it('입력 누락은 그 칸 바로 아래에 붙고 칸이 오류 상태가 된다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          newPostOpen: true,
          newPostErrors: {
            title: '제목을 입력해 주세요.',
            body: '내용을 입력해 주세요.',
          },
          newPostShowFieldErrors: true,
        })}
      />,
    );

    // 문구가 화면 어딘가에 있는 것으로는 부족하다 — 그 칸이 가리키는 요소에 있어야
    // 낭독기가 칸 이름 뒤에 이유를 읽는다.
    const title = openingTag(html, 'board-new-post-title');
    expect(title).toContain('aria-invalid="true"');
    expect(title).toContain('aria-describedby="board-new-post-title-error"');
    expect(textOf(html, 'board-new-post-title-error')).toBe(
      '제목을 입력해 주세요.',
    );

    const body = openingTag(html, 'board-new-post-body');
    expect(body).toContain('aria-invalid="true"');
    expect(body).toContain('aria-describedby="board-new-post-body-error"');
    expect(textOf(html, 'board-new-post-body-error')).toBe(
      '내용을 입력해 주세요.',
    );
    // 두 칸이 모두 틀렸으므로 폼 맨 위에 개수 요약이 선다(R-16).
    expect(html).toContain('고칠 칸이 2개 있습니다');
    expect(html.indexOf('data-slot="form-error-summary"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-slot="form-error-summary"')).toBeLessThan(
      html.indexOf('id="board-new-post-title"'),
    );
  });

  it('한 번 누르기 전에는 빈 칸을 빨갛게 칠하지 않는다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          newPostOpen: true,
          newPostErrors: {
            title: '제목을 입력해 주세요.',
            body: '내용을 입력해 주세요.',
          },
          newPostShowFieldErrors: false,
        })}
      />,
    );
    expect(openingTag(html, 'board-new-post-title')).not.toContain(
      'aria-invalid="true"',
    );
    expect(html).not.toContain('제목을 입력해 주세요.');
    // 오류값은 이미 둘이지만 아직 누르지 않았으므로 요약도 없다.
    expect(html).not.toContain('data-slot="form-error-summary"');
  });

  it('서버가 거절한 실패는 경고 상자에만 남고 칸은 오류 상태가 아니다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          newPostOpen: true,
          newPostTitle: '제목 초안',
          newPostBody: '내용 초안',
          newPostShowFieldErrors: true,
          newPostSubmitError: '이 프로그램 게시판에 접근할 권한이 없습니다.',
        })}
      />,
    );

    expect(html).toContain('data-slot="alert"');
    expect(html).toContain('이 프로그램 게시판에 접근할 권한이 없습니다.');
    expect(openingTag(html, 'board-new-post-title')).not.toContain(
      'aria-invalid="true"',
    );
    expect(openingTag(html, 'board-new-post-body')).not.toContain(
      'aria-invalid="true"',
    );
    expect(html).not.toContain('data-slot="field-error"');
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

describe('BoardListContent — 참여자가 아닌 학생(#1099)', () => {
  const notParticipant = renderToStaticMarkup(
    <BoardListContent {...baseProps({ state: { kind: 'not-participant' } })} />,
  );

  it('빨간 실패가 아니라 「아직 참여자가 아닙니다」 안내를 보여준다', () => {
    expect(notParticipant).toContain('아직 참여자가 아닙니다');
    expect(notParticipant).toContain(
      '신청이 승인되면 공지를 읽고 질문을 남길 수 있습니다.',
    );
    expect(notParticipant).not.toContain('게시판을 불러오지 못했습니다');
    expect(notParticipant).not.toContain('다시 시도');
    // 실패 경고 상자(Alert)도, 그것이 붙이는 `role="alert"`도 서지 않는다 —
    // 이것은 실패가 아니라 정적으로 그려지는 상태다(docs/design.md §피드백·알림).
    expect(notParticipant).not.toContain('data-slot="alert"');
    expect(notParticipant).not.toContain('role="alert"');
  });

  it('눌러도 거절되는 「질문 쓰기」를 남기지 않는다', () => {
    expect(notParticipant).not.toContain('질문 쓰기');
    expect(notParticipant).not.toContain('공지 쓰기');
  });

  it('다음 행동으로 가는 링크를 준다', () => {
    expect(notParticipant).toContain('href="/programs/program-1/apply"');
    expect(notParticipant).toContain('href="/programs/program-1"');
    expect(notParticipant).toContain('신청하러 가기');
  });

  it('다른 실패에서는 「질문 쓰기」를 그대로 둔다 — 추측으로 지우지 않는다', () => {
    const html = renderToStaticMarkup(
      <BoardListContent
        {...baseProps({
          state: { kind: 'error', message: '문제가 발생했습니다.' },
        })}
      />,
    );

    expect(html).toContain('질문 쓰기');
    expect(html).toContain('다시 시도');
  });
});
