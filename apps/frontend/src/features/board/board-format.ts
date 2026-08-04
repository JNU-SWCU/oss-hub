import type { ProblemDetail } from '@/lib/api-client';
import type { BoardAuthorRole, BoardPostCategory } from './types';

/** 프로토타입 원문(`oss-hub-standalone-src.dc.html` boardRows/kindText)과 동일한 라벨. */
export const BOARD_CATEGORY_LABELS: Readonly<
  Record<BoardPostCategory, string>
> = {
  NOTICE: '공지',
  QNA: '질문',
};

export const BOARD_CATEGORY_BADGE_VARIANT: Readonly<
  Record<BoardPostCategory, 'recruiting' | 'pending'>
> = {
  NOTICE: 'recruiting',
  QNA: 'pending',
};

/**
 * 글 작성자의 역할 라벨. `category`는 작성자 역할이 그대로 결정하므로(교직원→공지,
 * 학생→질문, `board.service.ts` `createPost`) 역산해 보여준다.
 *
 * 서버 `BoardPostResponseDto`/`BoardPostDetailResponseDto`는 `authorId`만 내려주고
 * 표시 이름(닉네임)을 응답에 담지 않는다 — 실명 대신 이 역할 라벨만 보여준다.
 */
export function boardPostAuthorRoleLabel(category: BoardPostCategory): string {
  return category === 'NOTICE' ? '교직원' : '학생';
}

/**
 * 댓글 작성자 표시 이름 자리. 서버는 `authorId`만 주고 닉네임을 실지 않으므로
 * 공통 자리 표시만 둔다. 역할 구분은 `authorRole` 뱃지가 담당한다.
 */
export const BOARD_COMMENT_AUTHOR_LABEL = '참여자';

/**
 * 댓글 작성자 역할 라벨. 프로토타입은 학생/교직원 2종만 다루므로 ADMIN은
 * 교직원으로 접는다(게시판 접근·고정·공지 작성에서 ADMIN=교직원 권한과 동일).
 * 라벨 자체는 정적 표시 문구라 프런트 소유(ADR-008). 원본 `authorRole` 값은
 * 백엔드가 소유·전송한다.
 */
export const BOARD_COMMENT_AUTHOR_ROLE_LABEL: Readonly<
  Record<BoardAuthorRole, string>
> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '교직원',
};

/**
 * 역할칩 색 — `account-slot.tsx`와 동일하게 StatusBadge 톤을 재사용한다.
 * 학생 = recruiting, 교직원·ADMIN = approved.
 */
export const BOARD_COMMENT_AUTHOR_ROLE_VARIANT: Readonly<
  Record<BoardAuthorRole, 'recruiting' | 'approved'>
> = {
  STUDENT: 'recruiting',
  STAFF: 'approved',
  ADMIN: 'approved',
};

export function boardCommentAuthorRoleLabel(role: BoardAuthorRole): string {
  return BOARD_COMMENT_AUTHOR_ROLE_LABEL[role];
}

/** 프로토타입 `writeLabel`(#619 board 화면). */
export function boardWriteButtonLabel(isStaff: boolean): string {
  return isStaff ? '공지 쓰기' : '질문 쓰기';
}

/** 프로토타입 `boardSub` 원문. */
export function boardSubtitle(isStaff: boolean): string {
  return isStaff
    ? '공지를 올리고 학생 질문에 답합니다 · 글을 누르면 댓글이 펼쳐집니다'
    : '교직원 공지와 질문 글입니다 · 글을 누르면 댓글을 달 수 있습니다';
}

const BOARD_DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

export function formatBoardDateTime(iso: string): string {
  return BOARD_DATE_TIME_FORMAT.format(new Date(iso));
}

export function validateBoardPostInput(input: {
  readonly title: string;
  readonly body: string;
}): string | null {
  if (!input.title.trim()) return '제목을 입력해 주세요.';
  if (!input.body.trim()) return '내용을 입력해 주세요.';
  return null;
}

export function validateBoardCommentInput(body: string): string | null {
  return body.trim() ? null : '댓글 내용을 입력해 주세요.';
}

/** `board-error-code.enum.ts`(BRD_00N) → 한국어 문구. */
export function mapBoardError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'BRD_001':
      return '이 프로그램 게시판에 접근할 권한이 없습니다.';
    case 'BRD_002':
      return '게시글을 찾을 수 없습니다.';
    case 'BRD_003':
      return '댓글을 찾을 수 없습니다.';
    case 'BRD_004':
      return '작성자만 수정·삭제할 수 있습니다.';
    case 'BRD_005':
      return '교직원만 게시글을 고정할 수 있습니다.';
    default:
      return problem.detail || '요청을 처리하지 못했습니다.';
  }
}
