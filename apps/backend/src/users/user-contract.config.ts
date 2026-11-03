export const MemberKind = { STUDENT: 'STUDENT', STAFF: 'STAFF' } as const;
export type MemberKind = (typeof MemberKind)[keyof typeof MemberKind];

export const DepartmentType = {
  DEPARTMENT: 'DEPARTMENT',
  PROGRAM_OFFICE: 'PROGRAM_OFFICE',
} as const;
export type DepartmentType =
  (typeof DepartmentType)[keyof typeof DepartmentType];

export const StaffAccessRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REVOKED: 'REVOKED',
} as const;
export type StaffAccessRequestStatus =
  (typeof StaffAccessRequestStatus)[keyof typeof StaffAccessRequestStatus];
