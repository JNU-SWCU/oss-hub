type MemberKind = 'STUDENT' | 'STAFF';

export interface Me {
  readonly nickname: string;
  readonly name: string | null;

  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;

  readonly isProfileComplete: boolean;
}

export interface LogoutResult {
  readonly isAuthenticated: boolean;
}

export type AuthSession =
  | { readonly isAuthenticated: false }
  | { readonly isAuthenticated: true; readonly user: Me };
