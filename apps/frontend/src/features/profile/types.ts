import type { UserParticipation } from '@/lib/user-participation';

type DepartmentType = 'DEPARTMENT' | 'PROGRAM_OFFICE';

export interface UserProfile {
  readonly githubLogin: string;
  readonly memberKind: 'STUDENT' | 'STAFF' | null;
  readonly name: string;
  readonly studentId: string | null;
  readonly staffNumber: string | null;
  readonly department: string | null;
  readonly phone: string | null;
  readonly isComplete: boolean;
  readonly participations: readonly UserParticipation[];
}

export interface CompleteProfileRequest {
  readonly name: string;
  readonly studentId?: string;
  readonly phone?: string;
  readonly departmentType: DepartmentType;
  readonly department: string;
}

export interface UpdateProfileRequest {
  readonly name: string;
  readonly studentId?: string;
  readonly staffNumber?: string | null;
  readonly phone?: string;
  readonly department: string;
}

export interface ProfileFormValues {
  readonly name: string;

  readonly studentId: string;
  readonly phone: string;

  readonly savedStudentId: string;
  readonly departmentType: DepartmentType;
  readonly programOfficeName: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
}

export interface ProfileFormErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly phone: string | null;
  readonly department: string | null;
}
