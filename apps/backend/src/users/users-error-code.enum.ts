import type { ErrorCode } from '../common/error-code';

export enum UsersErrorCode {
  PROFILE_ALREADY_COMPLETE = 'USR_001',
  PROFILE_INCOMPLETE = 'USR_002',
  STUDENT_ID_IMMUTABLE = 'USR_003',
  STUDENT_ID_TAKEN = 'USR_004',
  STUDENT_ID_NEEDS_DEPARTMENT = 'USR_005',
  ACCOUNT_ALREADY_DEACTIVATED = 'USR_006',
  LAST_ACTIVE_ADMIN = 'USR_007',
  STUDENT_ID_TAKEN_BY_ADMIN = 'USR_008',
  PROFILE_UPDATE_CONFLICT = 'USR_009',
  PROFILE_COMPLETE_REQUIRES_POST = 'USR_010',
  LEGACY_RECLASSIFICATION_NOT_FOUND = 'USR_011',
  LEGACY_RECLASSIFICATION_CONFLICT = 'USR_012',
}

export const USERS_ERROR_CODES: Record<UsersErrorCode, ErrorCode> = {
  [UsersErrorCode.PROFILE_ALREADY_COMPLETE]: {
    code: UsersErrorCode.PROFILE_ALREADY_COMPLETE,
    status: 409,
    message: '온보딩 프로필이 이미 저장되었습니다.',
  },
  [UsersErrorCode.PROFILE_INCOMPLETE]: {
    code: UsersErrorCode.PROFILE_INCOMPLETE,
    status: 409,
    message: '역할을 선택하기 전에 온보딩 프로필을 완료해 주세요.',
  },
  [UsersErrorCode.STUDENT_ID_IMMUTABLE]: {
    code: UsersErrorCode.STUDENT_ID_IMMUTABLE,
    status: 400,
    message: '완료된 프로필의 학번은 변경할 수 없습니다.',
  },

  [UsersErrorCode.STUDENT_ID_TAKEN]: {
    code: UsersErrorCode.STUDENT_ID_TAKEN,
    status: 409,
    message: '이미 다른 계정이 사용 중인 학번입니다.',
  },

  [UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT]: {
    code: UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT,
    status: 400,
    message: '학번을 저장하려면 학과도 함께 입력해 주세요.',
  },
  [UsersErrorCode.ACCOUNT_ALREADY_DEACTIVATED]: {
    code: UsersErrorCode.ACCOUNT_ALREADY_DEACTIVATED,
    status: 409,
    message: '이미 비활성화된 계정입니다.',
  },
  [UsersErrorCode.LAST_ACTIVE_ADMIN]: {
    code: UsersErrorCode.LAST_ACTIVE_ADMIN,
    status: 409,
    message: '마지막 활성 관리자는 계정을 비활성화할 수 없습니다.',
  },

  [UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN]: {
    code: UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN,
    status: 409,
    message: '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
  },

  [UsersErrorCode.PROFILE_UPDATE_CONFLICT]: {
    code: UsersErrorCode.PROFILE_UPDATE_CONFLICT,
    status: 409,
    message:
      '다른 관리자가 동시에 같은 사용자의 프로필을 수정하고 있어 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  },

  [UsersErrorCode.PROFILE_COMPLETE_REQUIRES_POST]: {
    code: UsersErrorCode.PROFILE_COMPLETE_REQUIRES_POST,
    status: 409,
    message:
      '가입을 마치려면 이름과 학과를 한 번에 보내야 합니다. 부분 수정으로는 가입할 수 없습니다.',
  },
  [UsersErrorCode.LEGACY_RECLASSIFICATION_NOT_FOUND]: {
    code: UsersErrorCode.LEGACY_RECLASSIFICATION_NOT_FOUND,
    status: 404,
    message: '재분류할 회원 정보를 찾을 수 없습니다.',
  },
  [UsersErrorCode.LEGACY_RECLASSIFICATION_CONFLICT]: {
    code: UsersErrorCode.LEGACY_RECLASSIFICATION_CONFLICT,
    status: 409,
    message: '이미 다른 회원 유형으로 재분류되었습니다.',
  },
};
