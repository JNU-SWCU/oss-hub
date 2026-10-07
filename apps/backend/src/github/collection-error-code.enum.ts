import { ErrorCode } from '../common/error-code';

export enum CollectionErrorCode {
  ADMIN_REQUIRED = 'COL_004',
  COLLECTION_RUN_IN_PROGRESS = 'COL_006',
  COLLECTION_APP_UNAVAILABLE = 'COL_007',
  COLLECTION_QUIESCED = 'COL_008',
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
  [CollectionErrorCode.COLLECTION_APP_UNAVAILABLE]: {
    code: CollectionErrorCode.COLLECTION_APP_UNAVAILABLE,
    status: 503,
    message: 'Collection App 설정이 준비되지 않아 수집을 시작할 수 없습니다.',
    exposeToClient: true,
  },
  [CollectionErrorCode.COLLECTION_QUIESCED]: {
    code: CollectionErrorCode.COLLECTION_QUIESCED,
    status: 409,
    message: '저장소 전환 작업이 진행 중이라 수집을 시작할 수 없습니다.',
    exposeToClient: true,
  },
};
