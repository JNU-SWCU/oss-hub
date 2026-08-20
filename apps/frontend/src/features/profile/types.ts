export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

/**
 * 가입 마치기·설정 갱신이 같은 본문을 쓴다. 이름·학과는 항상 보내고, 학번은
 * 없을 때만 키를 뺀다 — 백엔드 DTO가 빈 학과를 `@IsNotEmpty`로 거부한다.
 */
export interface CompleteProfileRequest {
  readonly name: string;
  readonly studentId?: string;
  readonly department: string;
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
  readonly department: string;
}

export interface ProfileFormValues {
  readonly name: string;
  /** 입력란의 현재 값. 불러온 직후에는 `savedStudentId`와 같다. */
  readonly studentId: string;
  /**
   * 불러온 시점에 서버에 저장돼 있던 학번(''이면 아직 없음).
   *
   * 형식 검증의 예외를 가르는 기준이다 — 저장된 값 그대로면 형식을 다시 보지 않고
   * 요청에도 싣지 않는다. 입력란의 `studentId`만으로는 사용자가 방금 친 값인지
   * 불러온 값인지 구분할 수 없다. 설정 화면(`SettingsFormValues`)이 같은 이유로
   * 같은 항목을 들고 있다.
   */
  readonly savedStudentId: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
}

export interface ProfileFormErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}
