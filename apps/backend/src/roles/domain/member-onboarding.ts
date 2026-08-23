import type {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';

/**
 * 가입 절차에서 고를 수 있는 회원 유형.
 *
 * `MemberKind`와 값 집합이 같지만 이름을 따로 두는 이유는, 이 타입이 답하는 질문이
 * "이 사람은 누구인가"가 아니라 "가입 화면이 무엇을 제시하는가"이기 때문이다.
 */
export type SelectableMemberKind = MemberKind;

/** 프로필 완료 판정에 필요한 만큼의 프로필 값. 없으면 세 칸 모두 null이다. */
export type MemberProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type MemberUser = {
  readonly id: string;
  /** 확정된 회원 유형 — 프로필 행이 만들어져야 붙는다(#569). */
  readonly memberKind: MemberKind | null;
  /**
   * 가입 절차에서 고른 회원 유형 — 기록일 뿐 확정이 아니다.
   *
   * 프로필 화면이 무엇을 물어야 할지 정하는 근거이자, 가입을 마칠 때 무엇을 만들지의
   * 근거다.
   */
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  /**
   * 지금 저장돼 있는 프로필 값.
   *
   * 회원 유형 선택이 "여기서 요청을 열지"를 판단하는 데 쓴다 — **프로필을 이미 마친
   * 사람에게는 남은 단계가 없어서**, 기록만 하고 끝내면 요청이 영원히 열리지 않는다.
   * 회수(REVOKED)된 뒤 다시 고르는 사용자가 실제로 그 상태다.
   */
  readonly profile: MemberProfileFields;
};

export type StaffAccessRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

/**
 * 회원 유형 선택 화면이 받는 답 — **무엇을 골랐는지와 어디로 가는지뿐이다.**
 *
 * 예전에는 확정 결과도 함께 실었다. 확정을 `가입 마치기`로 미룬 뒤로는(#569) 이
 * 화면이 확정하는 것이 없어 알려 줄 결과도 없다 — 칸을 남겨 두면 항상 null인 값을
 * 보고 "여기서도 확정될 수 있다"고 읽게 된다.
 */
export type MemberKindSelectionResult = {
  readonly selectedMemberKind: SelectableMemberKind;
  /**
   * 선택 직후의 목적지 — 학생·교직원 모두 프로필 입력이다.
   *
   * 값이 하나뿐인 이유는 `roles.service.ts`에 있다: 고르기만 해서는 가입이 끝나지 않고,
   * 교직원도 소속이 필수라 남은 단계가 같다. 프로필을 마친 교직원을 승인 대기로 잇는
   * 일은 화면의 게이트가 하지 이 응답이 하지 않는다.
   */
  readonly redirectTo: '/onboarding/profile';
};

/**
 * 지금 고른 회원 유형이 무엇인가 — 선택 화면이 다시 열릴 때 필요한 값.
 *
 * 세션 응답이 아니라 이 도메인이 답하는 이유는, 고른 유형이 권한이 아니라 가입 절차의
 * 상태이기 때문이다 — 세션에 실으면 아직 확정되지 않은 값이 권한처럼 읽힌다.
 */
export type MemberKindSelectionState = {
  readonly selectedMemberKind: SelectableMemberKind | null;
};
