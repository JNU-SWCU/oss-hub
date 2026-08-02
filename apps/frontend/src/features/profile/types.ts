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

/**
 * 완료된 프로필 갱신 요청.
 *
 * 학번은 **아직 저장된 값이 없을 때만** 실린다. 한 번 저장된 학번은 학적
 * 식별자로 고정돼 다른 값으로 바꿀 수 없으므로(`USR_003`), 이미 값이 있으면
 * 키 자체를 빼고 보낸다.
 */
export interface UpdateProfileRequest {
  readonly name: string;
  readonly studentId?: string;
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
