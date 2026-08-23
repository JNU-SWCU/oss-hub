export type AuthRole = 'STUDENT' | 'STAFF' | 'ADMIN';
export type MemberKind = 'STUDENT' | 'STAFF';

export interface Me {
  readonly nickname: string;
  readonly name: string | null;
  /** GitHub OAuth primary 캐시. 없을 수 있다. 알림 수신 주소 SoT는 notification-email API. */
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  /**
   * 프로필 완료 여부.
   *
   * 온보딩이 약관 → 유형 → 프로필 순서라 "고르긴 골랐는데 프로필은 비어 있는"
   * 사용자가 정상적으로 존재한다. 게이트가 그를 프로필 단계로 되돌리려면 세션 하나로
   * 알 수 있어야 한다 — 화면마다 프로필을 따로 조회하면 판단이 갈라진다.
   */
  readonly isProfileComplete: boolean;
}

export interface LogoutResult {
  readonly isAuthenticated: boolean;
}

export type AuthSession =
  | { readonly isAuthenticated: false }
  | { readonly isAuthenticated: true; readonly user: Me };
