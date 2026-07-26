import { ErrorCode } from '../common/error-code';

export enum CollectionErrorCode {
  ADMIN_REQUIRED = 'COL_004',
  COLLECTION_RUN_IN_PROGRESS = 'COL_006',
}

export const COLLECTION_ERROR_CODES: Record<CollectionErrorCode, ErrorCode> = {
  [CollectionErrorCode.ADMIN_REQUIRED]: {
    code: CollectionErrorCode.ADMIN_REQUIRED,
    status: 403,
    message: '관리자 권한이 필요합니다.',
  },
  [CollectionErrorCode.COLLECTION_RUN_IN_PROGRESS]: {
    code: CollectionErrorCode.COLLECTION_RUN_IN_PROGRESS,
    status: 409,
    message: '수집이 이미 진행 중입니다.',
    exposeToClient: true,
  },
};
