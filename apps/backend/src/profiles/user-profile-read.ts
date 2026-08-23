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
 * 그 `null`은 「그 사람의 유형이 STUDENT/STAFF 중 무엇인지 **아직 기록되지 않았다**」는
 * 뜻이지 「어느 쪽이라고 추정해도 된다」는 뜻이 아니다.
 *
 * 이 공백을 접는 전용 헬퍼를 따로 두지 않는다. 그런 함수를 두면 모든 호출부가 그것을
 * 지나가도록 강제할 방법이 없어 「단일 경계」라는 말만 남고 실제로는 아무도 쓰지 않는
 * 죽은 추상이 된다. 대신 이 칸을 읽는 두 모양이 **둘 다 NULL에서 자연히
 * fail-closed**라는 점에 기대어 있다.
 *
 *   1. **질의 경계**: `profile: { is: { memberKind: 'STUDENT' } }`처럼 양성 조건으로
 *      걸러낸다. SQL에서 `NULL = 'STUDENT'`는 참이 아니므로 미확정 행은 저절로 빠진다
 *      (`STUDENT_MEMBER_WHERE`).
 *   2. **투영 경계**: `profile?.memberKind ?? null`로 읽어 그대로 내보낸다. 판정은
 *      언제나 `=== MemberKind.STUDENT` 같은 양성 비교라 미확정은 어느 분기에도
 *      들어가지 않는다.
 *
 * 어느 쪽이든 legacy `User.role`을 대신 읽지 않고, ADMIN이라는 사실에서 회원 유형을
 * 유도하지도 않는다 — 권한과 정체성은 서로를 함의하지 않는다.
 *
 * 접근 권한 두 칸은 이 공백과 무관하다. bridge 마이그레이션이 backfill 뒤
 * NOT NULL + DEFAULT FALSE로 잠그므로 언제나 boolean이고, 새 계정은 「권한 없음」에서
 * 시작한다(fail-closed).
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
