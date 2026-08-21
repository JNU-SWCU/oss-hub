export type AuthRole = 'STUDENT' | 'STAFF' | 'ADMIN';
export type MemberKind = 'STUDENT' | 'STAFF';

export interface Me {
  readonly nickname: string;
  readonly name: string | null;
  /** GitHub OAuth primary 캐시. 없을 수 있다. 알림 수신 주소 SoT는 notification-email API. */
  readonly email: string | null;
  readonly avatarUrl: string | null;
  /** Todo 13까지 유지하는 legacy 호환 projection. UI surface 판정에는 쓰지 않는다. */
  readonly role: AuthRole | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  /**
   * 배정된 역할 기준 프로필 완료 여부.
   *
   * 온보딩이 약관 → 역할 → 프로필 순서라 "역할은 정해졌는데 프로필은 비어 있는"
   * 사용자가 정상적으로 존재한다. 게이트가 그를 프로필 단계로 되돌리려면 세션 하나로
   * 알 수 있어야 한다 — 화면마다 프로필을 따로 조회하면 판단이 갈라진다.
   * 역할이 아직 없는 사용자에 대해서는 의미를 두지 않는다(그쪽은 온보딩 게이트가
   * 프로필을 직접 조회한다).
   */
  readonly isProfileComplete: boolean;
}

export interface LogoutResult {
  readonly isAuthenticated: boolean;
}

export type AuthSession =
  | { readonly isAuthenticated: false }
  | { readonly isAuthenticated: true; readonly user: Me };
