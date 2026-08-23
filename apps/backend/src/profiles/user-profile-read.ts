import type { AffiliationKind, MemberKind, Prisma } from '@prisma/client';

/**
 * 프로필 세 값을 함께 읽는 면. `UserProfile` 행이 유일한 정본이므로 join 하나로 끝난다.
 */
export const USER_PROFILE_SELECT = {
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
    },
  },
} as const satisfies Prisma.UserSelect;

/**
 * 이름만 읽는 좁은 면. `USER_PROFILE_SELECT`를 대신 쓰지 않는다 — 그건 학번까지 함께
 * 끌고 와서 공개 응답의 "비공개 값 미read" 불변식을 깬다(AGENTS.md §4 redact-later 금지).
 */
export const USER_PROFILE_NAME_SELECT = {
  profile: { select: { name: true } },
} as const satisfies Prisma.UserSelect;

/** 소속만 읽는 세 번째 면. 실명을 끌고 오지 않는다. */
export const USER_PROFILE_DEPARTMENT_SELECT = {
  profile: { select: { department: true } },
} as const satisfies Prisma.UserSelect;

/**
 * 프로필 값의 읽기 표현.
 *
 * 세 칸이 모두 nullable인 이유는 **행이 없을 수 있기** 때문이지 칸이 비어 있을 수
 * 있어서가 아니다 — 행이 존재하면 `name`·`department`는 NOT NULL이고 `studentId`는
 * 회원 유형이 정한다(`UserProfile_studentId_memberKind_check`).
 */
export type UserProfileView = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

/**
 * 프로필 행의 원본 모양. 세 canonical 칸이 `null`일 수 있는 것은 **bridge 단계에서만**
 * 참이다 — 직전 이미지 v0.6.110이 새 프로필 행을 만들 때 그 세 칸을 쓰지 않기 때문에
 * 물리 컬럼을 nullable로 남겼다(`schema.prisma` 주석 참고).
 *
 * 그 `null`을 정본 사실로 접는 자리는 이 파일의 `resolveCanonicalMembership` **하나뿐이다**.
 * 다른 어느 모듈도 이 세 칸을 직접 읽고 fallback을 다시 쓰지 않는다.
 */
export type UserProfileSource = {
  readonly profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
    readonly memberKind?: MemberKind | null;
    readonly affiliationKind?: AffiliationKind | null;
    readonly affiliationName?: string | null;
  } | null;
};

export type UserProfileNameSource = {
  readonly profile: { readonly name: string } | null;
};

export type UserProfileDepartmentSource = {
  readonly profile: { readonly department: string } | null;
};

export function resolveUserProfile(source: UserProfileSource): UserProfileView {
  const profile = source.profile;
  return {
    name: profile?.name ?? null,
    studentId: profile?.studentId ?? null,
    department: profile?.department ?? null,
  };
}

export function resolveUserProfileName(
  source: UserProfileNameSource,
): string | null {
  return source.profile?.name ?? null;
}

export function resolveUserProfileDepartment(
  source: UserProfileDepartmentSource,
): string | null {
  return source.profile?.department ?? null;
}

/** 이름으로 사용자를 찾는 where 절. 프로필이 없는 계정은 자연히 걸리지 않는다. */
export function userProfileNameWhere(query: string): Prisma.UserWhereInput {
  return {
    profile: { is: { name: { contains: query, mode: 'insensitive' } } },
  };
}

/**
 * 학생 회원인가 — 회원 유형이 STUDENT이면 관리자 권한과 독립적으로 포함한다.
 *
 * 이 술어를 쓰는 자리는 신청·팀 참여처럼 **학생으로서** 하는 행동이므로 학생 관리자도
 * 학생 자격으로 통과한다. 회원 유형이 아직 비어 있는 bridge 행은 걸리지 않는다 —
 * SQL의 `NULL = 'STUDENT'`는 참이 아니므로 fail-closed가 저절로 성립한다.
 */
export const STUDENT_MEMBER_WHERE = {
  profile: { is: { memberKind: 'STUDENT' } },
} as const satisfies Prisma.UserWhereInput;

/**
 * 회원 정체성의 정본 투영. **bridge 단계의 단일 경계다.**
 *
 * 물리 컬럼 세 칸(`memberKind`·`affiliationKind`·`affiliationName`)이 nullable인 이유는
 * 직전 이미지 v0.6.110이 프로필 행을 만들 때 그 칸들을 쓰지 않기 때문이고, 그 이미지로
 * 되돌아갈 수 있어야 하는 동안에는 NOT NULL을 걸 수 없다. 그래서 정본 코드가 마주치는
 * `null`은 「그 사람의 유형이 STUDENT/STAFF 중 무엇인지 **아직 기록되지 않았다**」는
 * 뜻이지 「어느 쪽이라고 추정해도 된다」는 뜻이 아니다.
 *
 * 그래서 이 함수는 값을 **지어내지 않는다**:
 *
 *   * 회원 유형이 비어 있으면 `null`을 그대로 돌려준다. 호출부는 유형이 필요한 화면에서
 *     그 사람을 미확정으로 다루면 된다 — legacy `User.role`을 대신 읽지 않는다.
 *   * 접근 권한(`hasStaffAccess`·`hasAdminAccess`)은 **여기서 손대지 않는다.** 그 두 칸은
 *     bridge 마이그레이션이 backfill 뒤 NOT NULL + DEFAULT FALSE로 잠갔으므로 언제나
 *     boolean이고, 새 계정은 「권한 없음」에서 시작한다(fail-closed).
 *   * ADMIN이라는 사실에서 STAFF나 회원 유형을 유도하지 않는다. 세 사실은 서로를
 *     함의하지 않는다 — 관리자가 곧 교직원도, 학생도 아니다.
 *
 * `affiliationName`만 `department`로 접는다. 두 값은 같은 사실의 두 사본이고
 * (contract 단계의 `UserProfile_department_affiliationName_check`가 그것을 못박는다)
 * `department`는 이미 NOT NULL이라 추정이 아니라 **같은 값의 다른 이름**이다.
 */
export type CanonicalMembership = {
  readonly memberKind: MemberKind | null;
  readonly affiliationKind: AffiliationKind | null;
  readonly affiliationName: string | null;
};

export function resolveCanonicalMembership(
  source: UserProfileSource,
): CanonicalMembership {
  const profile = source.profile;
  if (profile === null) {
    return { memberKind: null, affiliationKind: null, affiliationName: null };
  }
  return {
    memberKind: profile.memberKind ?? null,
    affiliationKind: profile.affiliationKind ?? null,
    affiliationName: profile.affiliationName ?? profile.department,
  };
}
