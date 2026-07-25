export type AuthRole = 'STUDENT' | 'STAFF' | 'ADMIN';

export interface Me {
  readonly nickname: string;
  readonly name: string | null;
  /** GitHub OAuth primary 캐시. 없을 수 있다. 알림 수신 주소 SoT는 notification-email API. */
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly role: AuthRole | null;
}

export interface LogoutResult {
  readonly isAuthenticated: boolean;
}

export type AuthSession =
  | { readonly isAuthenticated: false }
  | { readonly isAuthenticated: true; readonly user: Me };
