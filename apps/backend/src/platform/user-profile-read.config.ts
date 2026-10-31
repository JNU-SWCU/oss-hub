import { type AffiliationKind, MemberKind } from '@prisma/client';

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
} as const;

export const USER_PROFILE_NAME_SELECT = {
  profile: { select: { name: true } },
} as const;

export const USER_PROFILE_DEPARTMENT_SELECT = {
  profile: { select: { department: true } },
} as const;

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

export function userProfileNameWhere(query: string) {
  return {
    profile: {
      is: { name: { contains: query, mode: 'insensitive' as const } },
    },
  };
}

export const STUDENT_MEMBER_WHERE = {
  profile: { is: { memberKind: 'STUDENT' } },
} as const;
