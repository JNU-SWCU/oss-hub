import { ErrorCode } from '../common/error-code';

export enum CollectionErrorCode {
  RATE_LIMITED = 'COL_001',
  COLLECTION_RUN_NOT_READY = 'COL_002',
  BATCH_LOGIN_NOT_ALLOWED = 'COL_003',
  ADMIN_REQUIRED = 'COL_004',
  COLLECTION_SCOPE_DISABLED = 'COL_005',
}

export const COLLECTION_ERROR_CODES: Record<CollectionErrorCode, ErrorCode> = {
  [CollectionErrorCode.RATE_LIMITED]: {
    code: CollectionErrorCode.RATE_LIMITED,
    status: 429,
    message: 'GitHub API 요청 한도에 도달했습니다.',
  },
  [CollectionErrorCode.COLLECTION_RUN_NOT_READY]: {
    code: CollectionErrorCode.COLLECTION_RUN_NOT_READY,
    status: 429,
    message: '수집이 이미 진행 중이거나 재요청 대기 시간입니다.',
  },
  [CollectionErrorCode.BATCH_LOGIN_NOT_ALLOWED]: {
    code: CollectionErrorCode.BATCH_LOGIN_NOT_ALLOWED,
    status: 400,
    message: '허용 목록 밖의 GitHub 계정이 포함되어 있습니다.',
  },
  [CollectionErrorCode.ADMIN_REQUIRED]: {
    code: CollectionErrorCode.ADMIN_REQUIRED,
    status: 403,
    message: '관리자 권한이 필요합니다.',
  },
  [CollectionErrorCode.COLLECTION_SCOPE_DISABLED]: {
    code: CollectionErrorCode.COLLECTION_SCOPE_DISABLED,
    status: 503,
    message: '현재 환경에서는 사용자 중심 수집을 사용할 수 없습니다.',
    exposeToClient: true,
  },
};
