export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

/**
 * 학번·학과는 역할에 따라 필수가 아니다(`profile-requirements`). 값이 없는
 * 항목은 빈 문자열 대신 키 자체를 빼고 보낸다 — 백엔드 DTO가 빈 문자열을
 * `@IsNotEmpty`로 거부하고, 학번은 아예 없을 때만 생략으로 취급한다.
 */
export interface CompleteProfileRequest {
  readonly name: string;
  readonly studentId?: string;
  readonly department?: string;
}

/** 완료된 프로필의 이름·학과만 갱신 — 학번은 불변이라 요청에 포함하지 않는다. */
export interface UpdateProfileRequest {
  readonly name: string;
  readonly department?: string;
}

export interface ProfileFormValues {
  readonly name: string;
  readonly studentId: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
}

export interface ProfileFormErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}
