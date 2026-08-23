import { AccountStatus, MemberKind } from '@prisma/client';

export interface AuthUser {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  /**
   * 고른 회원 유형 기준으로 프로필이 완료됐는가.
   *
   * 온보딩 순서가 유형 → 프로필이라 "고르긴 골랐는데 프로필은 비어 있는" 상태가
   * 정상적으로 존재한다. 화면 게이트와 로그인 착륙 지점이 그 사용자를 프로필 단계로
   * 되돌리려면 세션이 이 사실을 알아야 한다.
   */
  readonly isProfileComplete: boolean;
}

export interface ActiveAccountPrincipal extends AuthUser {
  readonly accountStatus: typeof AccountStatus.ACTIVE;
}

export interface AuthLoginResult {
  user: AuthUser;
  isNew: boolean;
}

/** GitHub /user·/user/emails 응답에서 검증을 거쳐 만든 내부 값 — 액세스 토큰은 여기 포함되지 않는다. */
export interface GithubProfile {
  githubId: bigint;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** GitHub primary 이메일. 없으면 null — 로그에 남기지 않는다. */
  email: string | null;
}
