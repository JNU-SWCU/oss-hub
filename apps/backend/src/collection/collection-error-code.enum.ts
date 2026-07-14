import { ErrorCode } from '../common/error-code';

export enum CollectionErrorCode {
  RATE_LIMITED = 'COL_001',
  BATCH_LOGIN_NOT_ALLOWED = 'COL_003',
}

export const COLLECTION_ERROR_CODES: Record<CollectionErrorCode, ErrorCode> = {
  [CollectionErrorCode.RATE_LIMITED]: {
    code: CollectionErrorCode.RATE_LIMITED,
    status: 429,
    message: 'GitHub API 요청 한도에 도달했습니다.',
  },
  [CollectionErrorCode.BATCH_LOGIN_NOT_ALLOWED]: {
    code: CollectionErrorCode.BATCH_LOGIN_NOT_ALLOWED,
    status: 400,
    message: '허용 목록 밖의 GitHub 계정이 포함되어 있습니다.',
  },
};
