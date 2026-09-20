import type { ErrorCode } from '../common/error-code';

export enum RepositoryConnectionsErrorCode {
  NOT_FOUND = 'REPO_001',
  FORBIDDEN = 'REPO_002',
  CLAIM_CONFLICT = 'REPO_003',
  INVALID_TARGET = 'REPO_004',
  INVALID_STATE = 'REPO_005',
}

export const REPOSITORY_CONNECTIONS_ERROR_CODES: Record<
  RepositoryConnectionsErrorCode,
  ErrorCode
> = {
  [RepositoryConnectionsErrorCode.NOT_FOUND]: {
    code: RepositoryConnectionsErrorCode.NOT_FOUND,
    status: 404,
    message: '저장소 연결 대상을 찾을 수 없습니다.',
  },
  [RepositoryConnectionsErrorCode.FORBIDDEN]: {
    code: RepositoryConnectionsErrorCode.FORBIDDEN,
    status: 403,
    message: '저장소 연결을 바꿀 권한이 없습니다.',
  },
  [RepositoryConnectionsErrorCode.CLAIM_CONFLICT]: {
    code: RepositoryConnectionsErrorCode.CLAIM_CONFLICT,
    status: 409,
    message: '다른 신청에서 이미 연결한 저장소입니다.',
  },
  [RepositoryConnectionsErrorCode.INVALID_TARGET]: {
    code: RepositoryConnectionsErrorCode.INVALID_TARGET,
    status: 422,
    message: '저장소 연결 대상을 확인할 수 없습니다.',
  },
  [RepositoryConnectionsErrorCode.INVALID_STATE]: {
    code: RepositoryConnectionsErrorCode.INVALID_STATE,
    status: 409,
    message: '현재 신청 상태에서는 저장소 연결을 바꿀 수 없습니다.',
  },
};
