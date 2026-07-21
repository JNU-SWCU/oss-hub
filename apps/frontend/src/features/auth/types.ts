export type AuthRole = 'STUDENT' | 'STAFF' | 'ADMIN';

export interface Me {
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly role: AuthRole | null;
}

export interface LogoutResult {
  readonly isAuthenticated: boolean;
}

export type AuthSession =
  | { readonly isAuthenticated: false }
  | { readonly isAuthenticated: true; readonly user: Me };
