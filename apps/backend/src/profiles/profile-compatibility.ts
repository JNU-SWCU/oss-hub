import type { Prisma } from '@prisma/client';

export const COMPATIBLE_PROFILE_SELECT = {
  name: true,
  studentId: true,
  department: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
    },
  },
} as const satisfies Prisma.UserSelect;

export const COMPATIBLE_PROFILE_NAME_SELECT = {
  name: true,
  profile: { select: { name: true } },
} as const satisfies Prisma.UserSelect;

/**
 * 학과만 읽는 세 번째 면. `COMPATIBLE_PROFILE_SELECT`를 대신 쓰지 않는다 — 그건 실명을
 * 함께 끌고 와서 공개 랭킹의 "실명 미read" 불변식을 깬다(AGENTS.md §4 redact-later 금지).
 */
export const COMPATIBLE_PROFILE_DEPARTMENT_SELECT = {
  department: true,
  profile: { select: { department: true } },
} as const satisfies Prisma.UserSelect;

export type CompatibleProfile = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type CompleteCompatibleProfile = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

export type CompatibleProfileSource = CompatibleProfile & {
  readonly profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
  } | null;
};

export type CompatibleProfileNameSource = {
  readonly name: string | null;
  readonly profile: { readonly name: string } | null;
};

export type CompatibleProfileDepartmentSource = {
  readonly department: string | null;
  readonly profile: { readonly department: string } | null;
};

export function resolveCompatibleProfile(
  source: CompatibleProfileSource,
): CompatibleProfile {
  return (
    source.profile ?? {
      name: source.name,
      studentId: source.studentId,
      department: source.department,
    }
  );
}

export function resolveCompatibleProfileName(
  source: CompatibleProfileNameSource,
): string | null {
  return source.profile?.name ?? source.name;
}

/**
 * UserProfile의 학과가 있으면 그걸, 없으면 User의 legacy 학과를 쓴다.
 * `User.department`만 읽으면 UserProfile로 넘어간 사용자가 전부 null이 되어 화면이 빈다.
 */
export function resolveCompatibleProfileDepartment(
  source: CompatibleProfileDepartmentSource,
): string | null {
  return source.profile?.department ?? source.department;
}

export function compatibleProfileNameWhere(
  query: string,
): Prisma.UserWhereInput {
  const contains = { contains: query, mode: 'insensitive' as const };
  return {
    OR: [
      { profile: { is: { name: contains } } },
      { profile: { is: null }, name: contains },
    ],
  };
}
