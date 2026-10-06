import type { ProblemDetail } from '@/lib/api-client';
import type { BoardAuthorRole, BoardPostCategory } from './types';

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

export function boardPostAuthorRoleLabel(category: BoardPostCategory): string {
  return category === 'NOTICE' ? '교직원' : '학생';
}

export const BOARD_COMMENT_AUTHOR_LABEL = '참여자';

export const BOARD_COMMENT_AUTHOR_ROLE_LABEL: Readonly<
  Record<BoardAuthorRole, string>
> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '교직원',
};

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

export function boardWriteButtonLabel(isStaff: boolean): string {
  return isStaff ? '공지 쓰기' : '질문 쓰기';
}

export function boardSubtitle(isStaff: boolean): string {
  return isStaff ? '프로그램 공지와 학생 질문' : '프로그램 공지와 질문';
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

export interface BoardPostInputErrors {
  readonly title: string | null;
  readonly body: string | null;
}

export function validateBoardPostInput(input: {
  readonly title: string;
  readonly body: string;
}): BoardPostInputErrors {
  return {
    title: input.title.trim() ? null : '제목을 입력해 주세요.',
    body: input.body.trim() ? null : '내용을 입력해 주세요.',
  };
}

export function hasBoardPostInputError(errors: BoardPostInputErrors): boolean {
  return errors.title !== null || errors.body !== null;
}

export function validateBoardCommentInput(body: string): string | null {
  return body.trim() ? null : '댓글 내용을 입력해 주세요.';
}

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
