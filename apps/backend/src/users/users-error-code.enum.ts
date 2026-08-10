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
  // 다시 시도해도 결과가 같다 — 화면은 "잠시 후 다시" 대신 다른 학번을 확인하도록 안내한다.
  [UsersErrorCode.STUDENT_ID_TAKEN]: {
    code: UsersErrorCode.STUDENT_ID_TAKEN,
    status: 409,
    message: '이미 다른 계정이 사용 중인 학번입니다.',
  },
  // 학번은 UserProfile 행에만 유일성 제약이 걸리고 그 행은 학과를 요구한다. 학과 없이
  // 학번만 받으면 제약 없는 구버전 컬럼에만 남아 같은 학번이 둘 생길 수 있다.
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
  // 자기 학번을 스스로 바꾸는 USR_004(STUDENT_ID_TAKEN)와 원인은 같지만 문맥이 다르다 —
  // 관리자가 남의 프로필을 고치다 충돌한 것이라 화면에서 서로 다른 안내가 필요해 코드를
  // 분리했다(관리자 수정 화면은 이 코드만 보고 "다른 사용자가 사용 중" 문구를 고른다).
  [UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN]: {
    code: UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN,
    status: 409,
    message: '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
  },
};
