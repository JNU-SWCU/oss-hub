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
export const STUDENT_MEMBER_WHERE = {
  profile: { is: { memberKind: 'STUDENT' } },
} as const;
