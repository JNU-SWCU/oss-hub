import { MemberKind } from '@prisma/client';

/**
 * 관리 화면이 한 사람을 한 단어로 부를 때 쓰는 표시 값.
 *
 * **권한 판정에 쓰지 않는다.** 판정은 언제나 `hasStaffAccess`·`hasAdminAccess`를 각각
 * 본다 — 이 값은 세 사실을 한 칸에 접어 넣은 표시용 요약이라, 접는 순간 학생 관리자가
 * "ADMIN"으로만 보이고 학생이라는 사실이 사라진다. 그 손실은 목록 표시에서는 감수할
 * 만하지만(관리자는 상세 화면에서 세 값을 그대로 본다) 인가에서는 곧 결함이다.
 *
 * 우선순위는 관리자 → 교직원 → 학생이다. 이 순서는 관리 목록이 "가장 강한 권한부터"
 * 훑는 기존 화면 순서를 그대로 유지하려는 것이고, 권한의 포함 관계를 뜻하지 않는다.
 */
export type AuthorityLabel = 'STUDENT' | 'STAFF' | 'ADMIN';

export type AuthorityLabelSource = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

/** 아직 아무 사실도 없는 계정(가입 미완료·권한 없음)은 `null`이다. */
export function authorityLabel(
  source: AuthorityLabelSource,
): AuthorityLabel | null {
  if (source.hasAdminAccess) {
    return 'ADMIN';
  }
  if (source.hasStaffAccess) {
    return 'STAFF';
  }
  return source.memberKind === MemberKind.STUDENT ? 'STUDENT' : null;
}
