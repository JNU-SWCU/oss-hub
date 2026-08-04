import { describe, expect, it } from 'vitest';
import {
  BOARD_CATEGORY_LABELS,
  BOARD_COMMENT_AUTHOR_LABEL,
  boardPostAuthorRoleLabel,
  boardSubtitle,
  boardWriteButtonLabel,
  formatBoardDateTime,
  mapBoardError,
  validateBoardCommentInput,
  validateBoardPostInput,
} from './board-format';

describe('board-format', () => {
  it('카테고리 라벨을 매핑한다', () => {
    expect(BOARD_CATEGORY_LABELS.NOTICE).toBe('공지');
    expect(BOARD_CATEGORY_LABELS.QNA).toBe('질문');
  });

  it('글 작성자 역할 라벨을 카테고리로 역산한다', () => {
    expect(boardPostAuthorRoleLabel('NOTICE')).toBe('교직원');
    expect(boardPostAuthorRoleLabel('QNA')).toBe('학생');
  });

  it('댓글 작성자는 항상 공통 라벨을 쓴다', () => {
    expect(BOARD_COMMENT_AUTHOR_LABEL).toBe('참여자');
  });

  it('교직원·학생 쓰기 버튼 라벨이 다르다', () => {
    expect(boardWriteButtonLabel(true)).toBe('공지 쓰기');
    expect(boardWriteButtonLabel(false)).toBe('질문 쓰기');
  });

  it('교직원·학생 안내 문구가 다르다', () => {
    expect(boardSubtitle(true)).toContain('공지를 올리고');
    expect(boardSubtitle(false)).toContain('교직원 공지와 질문');
  });

  it('서울 시간대로 날짜·시각을 포맷한다', () => {
    expect(formatBoardDateTime('2026-08-01T03:30:00.000Z')).toBe(
      '2026년 8월 1일 12:30',
    );
  });

  describe('validateBoardPostInput', () => {
    it('제목이 비어 있으면 에러를 반환한다', () => {
      expect(validateBoardPostInput({ title: '  ', body: '내용' })).toBe(
        '제목을 입력해 주세요.',
      );
    });

    it('내용이 비어 있으면 에러를 반환한다', () => {
      expect(validateBoardPostInput({ title: '제목', body: '  ' })).toBe(
        '내용을 입력해 주세요.',
      );
    });

    it('제목·내용이 모두 있으면 null을 반환한다', () => {
      expect(
        validateBoardPostInput({ title: '제목', body: '내용' }),
      ).toBeNull();
    });
  });

  describe('validateBoardCommentInput', () => {
    it('빈 댓글은 에러를 반환한다', () => {
      expect(validateBoardCommentInput('   ')).toBe(
        '댓글 내용을 입력해 주세요.',
      );
    });

    it('내용이 있으면 null을 반환한다', () => {
      expect(validateBoardCommentInput('댓글')).toBeNull();
    });
  });

  describe('mapBoardError', () => {
    const base = {
      type: 'about:blank',
      title: '오류',
      status: 403,
      detail: '원본 메시지',
      instance: '/x',
    };

    it('BRD_001~005 코드를 한국어 문구로 매핑한다', () => {
      expect(mapBoardError({ ...base, code: 'BRD_001' })).toBe(
        '이 프로그램 게시판에 접근할 권한이 없습니다.',
      );
      expect(mapBoardError({ ...base, code: 'BRD_002' })).toBe(
        '게시글을 찾을 수 없습니다.',
      );
      expect(mapBoardError({ ...base, code: 'BRD_003' })).toBe(
        '댓글을 찾을 수 없습니다.',
      );
      expect(mapBoardError({ ...base, code: 'BRD_004' })).toBe(
        '작성자만 수정·삭제할 수 있습니다.',
      );
      expect(mapBoardError({ ...base, code: 'BRD_005' })).toBe(
        '교직원만 게시글을 고정할 수 있습니다.',
      );
    });

    it('알 수 없는 코드는 detail을 그대로 보여준다', () => {
      expect(mapBoardError({ ...base, code: 'BRD_999' })).toBe('원본 메시지');
    });

    it('detail도 없으면 기본 문구를 보여준다', () => {
      expect(mapBoardError({ ...base, code: 'BRD_999', detail: '' })).toBe(
        '요청을 처리하지 못했습니다.',
      );
    });
  });
});
