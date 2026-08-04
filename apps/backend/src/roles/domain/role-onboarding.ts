import type { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { CompatibleProfile } from '../../profiles/profile-compatibility';

export type SelectableRole = typeof Role.STUDENT | typeof Role.STAFF;

export type RoleUser = {
  readonly id: string;
  /** 확정된 역할. 역할 선택만으로는 채워지지 않는다(#569). */
  readonly role: Role | null;
  /**
   * 가입 절차에서 고른 역할 — 기록일 뿐 확정이 아니다.
   *
   * 프로필 화면이 무엇을 물어야 할지 정하는 근거이자, 가입을 마칠 때 무엇을 확정할지의
   * 근거다. 값은 STUDENT · STAFF · null뿐이다(`prisma/schema.prisma`).
   */
  readonly selectedRole: Role | null;
  readonly accountStatus: AccountStatus;
  /**
   * 지금 저장돼 있는 프로필 값.
   *
   * 역할 선택이 "여기서 확정할지"를 판단하는 데 쓴다 — **프로필을 이미 마친 사람에게는
   * 남은 단계가 없어서**, 기록만 하고 끝내면 확정이 영원히 오지 않는다. 회수(REVOKED)된
   * 뒤 역할을 다시 고르는 사용자가 실제로 그 상태다.
   */
  readonly profile: CompatibleProfile;
};

export type RoleRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

/**
 * 역할 선택 화면이 받는 답 — **무엇을 골랐는지와 어디로 가는지뿐이다.**
 *
 * 예전에는 `role`·`requestStatus`도 함께 실었다. 그 자리에서 학생은 역할이 배정되고
 * 교직원은 승인 요청이 만들어졌으니 방금 무엇이 확정됐는지 알려 줄 것이 있었다. 확정을
 * `가입 마치기`로 미룬 뒤로는(#569) 이 화면이 확정하는 것이 없어 알려 줄 결과도 없다 —
 * 두 칸을 남겨 두면 항상 null인 값을 보고 "여기서도 확정될 수 있다"고 읽게 된다.
 */
export type RoleSelectionResult = {
  readonly selectedRole: SelectableRole;
  /**
   * 역할 선택 직후의 목적지 — 학생·교직원 모두 프로필 입력이다.
   *
   * 값이 하나뿐인 이유는 `roles.service.ts`에 있다: 고르기만 해서는 가입이 끝나지 않고,
   * 교직원도 학과가 필수라 남은 단계가 같다. 프로필을 마친 교직원을 승인 대기로 잇는
   * 일은 화면의 게이트가 하지 이 응답이 하지 않는다.
   *
   * 예전에는 `'/onboarding/pending'`도 허용했는데, 그 분기가 사라진 뒤에도 타입만
   * 남아 있으면 "여기서 대기 화면으로 보낼 수도 있다"는 잘못된 여지가 남는다.
   */
  readonly redirectTo: '/onboarding/profile';
};

/**
 * 지금 고른 역할이 무엇인가 — 역할 선택 화면이 다시 열릴 때 필요한 값.
 *
 * 확정을 `가입 마치기`로 미루면서 프로필 화면에서 역할 선택으로 되돌아갈 수 있게 됐고
 * (#569), 되돌아간 화면은 이전에 고른 것을 선택된 상태로 보여야 한다. 세션 응답
 * (`auth/me`)이 아니라 이 도메인이 답하는 이유는, 고른 역할이 권한이 아니라 가입 절차의
 * 상태이기 때문이다 — 세션에 실으면 아직 확정되지 않은 값이 권한처럼 읽힌다.
 */
export type RoleSelectionState = {
  readonly selectedRole: SelectableRole | null;
};
