export interface SettingsFormValues {
  readonly name: string;
  /** 입력란의 현재 값. 저장된 학번이 있으면 읽기 전용이라 그대로 유지된다. */
  readonly studentId: string;
  /** 불러온 시점에 서버에 저장돼 있던 학번(''이면 아직 없음). 수정 불가 판정의 기준. */
  readonly savedStudentId: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}

export interface SettingsFormErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly notificationEmail: string | null;
}

export type SettingsNotificationLoadState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'unavailable'; readonly message: string };
