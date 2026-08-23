import { AccountStatus, MemberKind } from '@prisma/client';
import { AuthUser } from '../domain/auth-user';

/** githubId(BigInt)는 노출하지 않는다 — JSON 직렬화 불가 + 외부 계약에 불필요. */
export class MeResponseDto {
  nickname: string;
  name: string | null;
  avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  /** 확정된 회원 유형. 프로필 행이 만들어져야 값이 붙는다. */
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  /**
   * 프로필 완료 여부.
   *
   * 온보딩이 유형 → 프로필 순서라 "고르긴 골랐는데 프로필이 비어 있는" 사용자가
   * 생긴다. 화면 게이트가 그를 프로필 단계로 되돌리려면 세션 하나로 알 수 있어야
   * 한다 — 페이지마다 프로필을 따로 조회하면 요청이 배로 늘고 판단이 화면마다
   * 갈라진다.
   */
  readonly isProfileComplete: boolean;

  private constructor(user: AuthUser) {
    this.nickname = user.nickname;
    this.name = user.name;
    this.avatarUrl = user.avatarUrl;
    this.accountStatus = user.accountStatus;
    this.memberKind = user.memberKind;
    this.hasStaffAccess = user.hasStaffAccess;
    this.hasAdminAccess = user.hasAdminAccess;
    this.isProfileComplete = user.isProfileComplete;
  }

  static from(user: AuthUser): MeResponseDto {
    return new MeResponseDto(user);
  }
}
