type AffiliationKind = 'DEPARTMENT' | 'PROGRAM_OFFICE';

export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly staffNumber: string | null;
  readonly department: string | null;
  readonly phone: string | null;
  readonly isComplete: boolean;
}

export interface CompleteProfileRequest {
  readonly name: string;
  readonly studentId?: string;
  readonly phone?: string;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
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
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
}

export interface ProfileFormErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly phone: string | null;
  readonly department: string | null;
}
