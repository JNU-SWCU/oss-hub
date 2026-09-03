import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BoardDetailContent,
  type BoardDetailContentProps,
} from './board-detail-view';
import type { BoardPostDetail } from '../types';

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
  commentCount: 2,
  canEdit: true,
  canDelete: true,
  comments: [
    {
      id: 'comment-staff',
      postId: 'post-1',
      authorRole: 'STAFF',
      authorName: '합성 교직원',
      body: '10월 17일 18시까지입니다.',
      createdAt: '2026-08-01T04:00:00.000Z',
      canDelete: true,
    },
    {
      id: 'comment-student',
      postId: 'post-1',
      authorRole: 'STUDENT',
      authorName: '합성 학생',
      body: '감사합니다.',
      createdAt: '2026-08-01T05:00:00.000Z',
      canDelete: true,
    },
  ],
};

function baseProps(
  overrides: Partial<BoardDetailContentProps> = {},
): BoardDetailContentProps {
  return {
    programId: 'program-1',
    isStaff: false,
    state: { kind: 'loading' },
    editing: false,
    editTitle: '',
    editBody: '',
    editSubmitting: false,
    editError: null,
    pinSubmitting: false,
    pinError: null,
    deleteSubmitting: false,
    deleteError: null,
    commentDraft: '',
    commentSubmitting: false,
    commentError: null,
    deletingCommentId: null,
    onRetry: () => {},
    onToggleEdit: () => {},
    onEditTitleChange: () => {},
    onEditBodyChange: () => {},
    onSubmitEdit: () => {},
    onDeletePost: () => {},
    onTogglePin: () => {},
    onCommentDraftChange: () => {},
    onSubmitComment: () => {},
    onDeleteComment: () => {},
    ...overrides,
  };
}

/**
 * 공백이 하나도 없는 200자. 붙여넣은 저장소 주소나 해시가 이 모양이다.
 * 본문과 댓글을 따로 집어야 해서 두 값을 다르게 둔다.
 */
const UNBROKEN_POST_BODY = `postbody${'0123456789'.repeat(19)}`;
const UNBROKEN_COMMENT_BODY = `commentbody${'0123456789'.repeat(19)}`;

/**
 * `text`를 직접 감싼 요소의 class를 꺼낸다.
 * 줄바꿈 규칙은 텍스트를 감싼 그 요소에 걸려야 뜻이 있으므로,
 * 문서 전체를 훑는 `expect(html).toContain(...)`으로는 어느 요소인지 구분되지 않는다.
 */
function classesWrapping(html: string, text: string): string {
  const textIndex = html.indexOf(text);
  expect(textIndex).toBeGreaterThan(-1);
  const openTag = html.slice(html.lastIndexOf('<', textIndex), textIndex);
  return /class="([^"]*)"/.exec(openTag)?.[1] ?? '';
}

describe('BoardDetailContent', () => {
  it('로딩 중에는 로딩 문구를 보여준다', () => {
    const html = renderToStaticMarkup(<BoardDetailContent {...baseProps()} />);
    expect(html).toContain('게시글을 불러오는 중');
    expect(html).toContain('게시판 목록');
  });

  it('찾을 수 없는 글은 안내 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent {...baseProps({ state: { kind: 'not-found' } })} />,
    );
    expect(html).toContain('게시글을 찾을 수 없습니다');
  });

  it('에러 상태는 안내와 다시 시도 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: { kind: 'error', message: '문제가 발생했습니다.' },
        })}
      />,
    );
    expect(html).toContain('게시글을 불러오지 못했습니다');
    expect(html).toContain('문제가 발생했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('글 상세와 댓글, 작성자 역할 라벨을 렌더한다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent {...baseProps({ state: { kind: 'ready', post } })} />,
    );
    expect(html).toContain('제출 마감일 문의드립니다');
    expect(html).toContain('중간 산출물 마감일이 정확히 언제인가요?');
    expect(html).toContain('합성 질문자');
    expect(html).toContain('합성 교직원');
    expect(html).toContain('합성 학생');
    expect(html).toContain('학생'); // 작성자(QNA) 역할 라벨
    expect(html).toContain('질문');
    expect(html).toContain('댓글 2');
    expect(html).toContain('10월 17일 18시까지입니다.');
    expect(html).toContain('교직원'); // 교직원 댓글 역할 태그
    expect(html).toContain('감사합니다.');
    expect(html).toContain('수정');
    expect(html).toContain('삭제');
    expect(html).toContain('댓글을 입력하세요');
    expect(html).toContain('댓글 달기');
  });

  it('교직원이 쓴 댓글에 교직원 역할 태그가 붙는다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: {
              ...post,
              commentCount: 1,
              comments: [post.comments[0]!],
            },
          },
        })}
      />,
    );
    expect(html).toContain('교직원 역할');
    expect(html).toContain('교직원');
    expect(html).not.toContain('학생 역할');
  });

  it('학생이 쓴 댓글에 학생 역할 태그가 붙는다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: {
              ...post,
              commentCount: 1,
              comments: [post.comments[1]!],
            },
          },
        })}
      />,
    );
    expect(html).toContain('학생 역할');
    expect(html).toContain('학생');
  });

  it('ADMIN 댓글은 표시 라벨을 교직원으로 접는다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: {
              ...post,
              commentCount: 1,
              comments: [
                {
                  id: 'comment-admin',
                  postId: 'post-1',
                  authorRole: 'ADMIN',
                  authorName: '합성 관리자',
                  body: '플랫폼 운영 안내입니다.',
                  createdAt: '2026-08-01T06:00:00.000Z',
                  canDelete: true,
                },
              ],
            },
          },
        })}
      />,
    );
    expect(html).toContain('교직원 역할');
    expect(html).toContain('교직원');
    expect(html).not.toContain('aria-label="관리자 역할"');
    expect(html).not.toContain('>관리자<');
  });

  it('서버 권한 필드가 없는 제3자에게 수정·삭제 버튼을 숨긴다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: {
              ...post,
              canEdit: false,
              canDelete: false,
              comments: post.comments.map((comment) => ({
                ...comment,
                canDelete: false,
              })),
            },
          },
        })}
      />,
    );
    expect(html).not.toContain('>수정<');
    expect(html).not.toContain('>삭제<');
  });

  it('작성자에게 자기 글 수정·삭제와 자기 댓글 삭제 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: {
              ...post,
              canEdit: true,
              canDelete: true,
              comments: [{ ...post.comments[1]!, canDelete: true }],
            },
          },
        })}
      />,
    );
    expect(html).toContain('>수정<');
    expect(html.match(/>삭제</g)).toHaveLength(2);
  });

  it('교직원에게 타인 글 수정은 숨기고 글·댓글 삭제만 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          isStaff: true,
          state: {
            kind: 'ready',
            post: {
              ...post,
              canEdit: false,
              canDelete: true,
              comments: [{ ...post.comments[0]!, canDelete: true }],
            },
          },
        })}
      />,
    );
    expect(html).not.toContain('>수정<');
    expect(html.match(/>삭제</g)).toHaveLength(2);
  });

  it('학생 뷰에는 고정 버튼이 없다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({ isStaff: false, state: { kind: 'ready', post } })}
      />,
    );
    expect(html).not.toContain('고정');
  });

  it('교직원 뷰에는 고정 버튼이 있고 고정 여부에 따라 라벨이 바뀐다', () => {
    const htmlUnpinned = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({ isStaff: true, state: { kind: 'ready', post } })}
      />,
    );
    expect(htmlUnpinned).toContain('고정');
    expect(htmlUnpinned).not.toContain('고정 해제');

    const htmlPinned = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          isStaff: true,
          state: { kind: 'ready', post: { ...post, pinned: true } },
        })}
      />,
    );
    expect(htmlPinned).toContain('고정 해제');
  });

  it('댓글이 없으면 빈 상태 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: { ...post, comments: [], commentCount: 0 },
          },
        })}
      />,
    );
    expect(html).toContain('아직 댓글이 없습니다.');
  });

  it('수정 모드에서는 입력값이 채워진 편집 폼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: { kind: 'ready', post },
          editing: true,
          editTitle: '수정된 제목',
          editBody: '수정된 내용',
        })}
      />,
    );
    expect(html).toContain('수정된 제목');
    expect(html).toContain('수정된 내용');
    expect(html).toContain('저장');
    expect(html).toContain('취소');
  });

  it('수정 중 에러 메시지를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: { kind: 'ready', post },
          editing: true,
          editError: '제목을 입력해 주세요.',
        })}
      />,
    );
    expect(html).toContain('제목을 입력해 주세요.');
  });

  it('삭제·고정·댓글 에러 메시지를 각각 보여준다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: { kind: 'ready', post },
          deleteError: '작성자만 수정·삭제할 수 있습니다.',
          pinError: '교직원만 게시글을 고정할 수 있습니다.',
          commentError: '댓글 내용을 입력해 주세요.',
        })}
      />,
    );
    expect(html).toContain('작성자만 수정·삭제할 수 있습니다.');
    expect(html).toContain('교직원만 게시글을 고정할 수 있습니다.');
    expect(html).toContain('댓글 내용을 입력해 주세요.');
  });
  it('공백 없는 긴 문자열을 본문과 댓글에서 접는다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent
        {...baseProps({
          state: {
            kind: 'ready',
            post: {
              ...post,
              body: UNBROKEN_POST_BODY,
              commentCount: 1,
              comments: [{ ...post.comments[0]!, body: UNBROKEN_COMMENT_BODY }],
            },
          },
        })}
      />,
    );

    // 접을 자리를 주지 않으면 상자를 넘치고, 넘친 부분은 카드(`card.tsx`의
    // `overflow-hidden`)가 잘라 낸다 — 가로 스크롤도 생기지 않아 아예 못 읽는다.
    expect(classesWrapping(html, UNBROKEN_POST_BODY)).toContain(
      '[overflow-wrap:anywhere]',
    );
    expect(classesWrapping(html, UNBROKEN_COMMENT_BODY)).toContain(
      '[overflow-wrap:anywhere]',
    );
  });

  it('한글 본문의 줄바꿈 자리를 옮기는 규칙은 걸지 않는다', () => {
    const html = renderToStaticMarkup(
      <BoardDetailContent {...baseProps({ state: { kind: 'ready', post } })} />,
    );
    const bodyClasses = classesWrapping(html, post.body);
    const commentClasses = classesWrapping(html, post.comments[0]!.body);

    // 저장된 값 자체는 자르거나 가공하지 않는다.
    expect(html).toContain(post.body);
    // 작성자가 넣은 줄바꿈을 살리는 자리는 그대로 둔다.
    expect(bodyClasses).toContain('whitespace-pre-wrap');

    // `word-break`(`break-all`·`break-keep`)는 넘치지 않는 한글에도 줄바꿈 자리를
    // 옮긴다. 이 티켓은 넘쳐서 잘리는 것만 고치므로 그 자리는 건드리지 않는다.
    for (const classes of [bodyClasses, commentClasses]) {
      expect(classes).not.toContain('break-all');
      expect(classes).not.toContain('break-keep');
      expect(classes).not.toContain('word-break');
    }
  });
});
