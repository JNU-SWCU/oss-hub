export const USER_PROFILE_SELECT = {
  name: true,
  studentId: true,
  department: true,
  type: true,
  departmentType: true,
  profileCreatedAt: true,
  profileUpdatedAt: true,
} as const;

export const USER_PROFILE_NAME_SELECT = { name: true } as const;
export const USER_PROFILE_DEPARTMENT_SELECT = { department: true } as const;

export const USER_AUTHORITY_SELECT = {
  ...USER_PROFILE_SELECT,
  approvalStatus: true,
  admin: { select: { userId: true } },
} as const;

export type UserProfileView = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type UserProfileNameSource = { readonly name: string | null };

export const STUDENT_MEMBER_WHERE = { type: 'STUDENT' } as const;
