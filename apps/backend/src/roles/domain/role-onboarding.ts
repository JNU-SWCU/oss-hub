import type { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';

export type SelectableRole = typeof Role.STUDENT | typeof Role.STAFF;

export type RoleUser = {
  readonly id: string;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
};

export type RoleRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

export type RoleSelectionResult = {
  readonly selectedRole: SelectableRole;
  readonly role: Role | null;
  readonly requestStatus: RoleRequestStatus | null;
  /**
   * 역할 선택 직후의 목적지 — 학생·교직원 모두 프로필 입력이다.
   *
   * 값이 하나뿐인 이유는 `roles.service.ts`에 있다: 역할이 정해져도 프로필을 받아야
   * 가입이 끝나고, 교직원도 학과가 필수라 남은 단계가 같다. 프로필을 마친 교직원을
   * 승인 대기로 잇는 일은 화면의 게이트가 하지 이 응답이 하지 않는다.
   *
   * 예전에는 `'/onboarding/pending'`도 허용했는데, 그 분기가 사라진 뒤에도 타입만
   * 남아 있으면 "여기서 대기 화면으로 보낼 수도 있다"는 잘못된 여지가 남는다.
   */
  readonly redirectTo: '/onboarding/profile';
};
