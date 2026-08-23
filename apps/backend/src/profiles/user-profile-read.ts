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

export type UserProfileSource = {
  readonly profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
    readonly memberKind?: MemberKind;
    readonly affiliationKind?: AffiliationKind;
    readonly affiliationName?: string;
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
 * 학생 자격으로 통과한다.
 */
export const STUDENT_MEMBER_WHERE = {
  profile: { is: { memberKind: 'STUDENT' } },
} as const satisfies Prisma.UserWhereInput;
