import { ErrorCode } from '../common/error-code';

export enum BoardErrorCode {
  ACCESS_FORBIDDEN = 'BRD_001',
  POST_NOT_FOUND = 'BRD_002',
  COMMENT_NOT_FOUND = 'BRD_003',
  NOT_AUTHOR = 'BRD_004',
  STAFF_ONLY = 'BRD_005',
}

export const BOARD_ERROR_CODES: Record<BoardErrorCode, ErrorCode> = {
  [BoardErrorCode.ACCESS_FORBIDDEN]: {
    code: BoardErrorCode.ACCESS_FORBIDDEN,
    status: 403,
    message: '이 프로그램 게시판에 접근할 권한이 없습니다.',
  },
  [BoardErrorCode.POST_NOT_FOUND]: {
    code: BoardErrorCode.POST_NOT_FOUND,
    status: 404,
    message: '게시글을 찾을 수 없습니다.',
  },
  [BoardErrorCode.COMMENT_NOT_FOUND]: {
    code: BoardErrorCode.COMMENT_NOT_FOUND,
    status: 404,
    message: '댓글을 찾을 수 없습니다.',
  },
  [BoardErrorCode.NOT_AUTHOR]: {
    code: BoardErrorCode.NOT_AUTHOR,
    status: 403,
    message: '작성자만 수정·삭제할 수 있습니다.',
  },
  [BoardErrorCode.STAFF_ONLY]: {
    code: BoardErrorCode.STAFF_ONLY,
    status: 403,
    message: '교직원만 게시글을 고정할 수 있습니다.',
  },
};
