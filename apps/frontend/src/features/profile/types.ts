export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

export interface CompleteProfileRequest {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
}

/** 완료된 프로필의 이름·학과만 갱신 — 학번은 불변이라 요청에 포함하지 않는다. */
export interface UpdateProfileRequest {
  readonly name: string;
  readonly department: string;
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
