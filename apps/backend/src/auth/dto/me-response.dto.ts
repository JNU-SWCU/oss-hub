import { AccountStatus, MemberKind } from '@prisma/client';
import { authorityLabel } from '../../common/authority-label';
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
   * **bridge 전용 표시 투영. 권한 판정에 쓰지 않는다.**
   *
   * 직전 프런트엔드 번들(v0.6.110)의 `use-session-role.ts`가 `user.role === null`로
   * **온보딩 분기 전체를 가른다**. 이 칸을 빼면 이미 가입을 마친 사용자까지 전부
   * 역할 선택 화면으로 되돌아간다 — 그 번들이 살아 있는 동안은 실제 장애다.
   *
   * 값은 **canonical 사실에서만 파생한다**(`authorityLabel`) — legacy `User.role`
   * 컬럼을 읽지 않는다. 그 컬럼은 롤백을 위해 남겨둔 것이지 사실의 근거가
   * 아니다. 서버측 인가는 언제나 `hasStaffAccess`·`hasAdminAccess`를 각각 보며,
   * 이 한 단어는 그 세 사실을 표시용으로 접은 요약일 뿐이다.
   *
   * 다음 contract PR이 직전 번들이 사라진 뒤 이 칸을 걷어낸다.
   */
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
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
    // canonical 세 사실에서만 접는다. legacy 컬럼을 읽지 않는다.
    this.role = authorityLabel({
      memberKind: user.memberKind,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
    });
    this.isProfileComplete = user.isProfileComplete;
  }

  static from(user: AuthUser): MeResponseDto {
    return new MeResponseDto(user);
  }
}
