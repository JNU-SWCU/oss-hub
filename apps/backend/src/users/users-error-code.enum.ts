import type { ErrorCode } from '../common/error-code';

export enum UsersErrorCode {
  PROFILE_ALREADY_COMPLETE = 'USR_001',
  PROFILE_INCOMPLETE = 'USR_002',
  STUDENT_ID_IMMUTABLE = 'USR_003',
  STUDENT_ID_TAKEN = 'USR_004',
  STUDENT_ID_NEEDS_DEPARTMENT = 'USR_005',
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
};
