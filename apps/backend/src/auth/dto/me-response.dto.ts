import { Role } from '@prisma/client';
import { AuthUser } from '../domain/auth-user';

/** githubId(BigInt)는 노출하지 않는다 — JSON 직렬화 불가 + 외부 계약에 불필요. */
export class MeResponseDto {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /**
   * 정식 소스는 DB `User.role`이다(Issue #109). 로컬 `AUTH_TEST_ROLE_MAP`(TestRoleMap, Issue #65)에
   * 해당 계정 항목이 있으면 그 값이 로컬 전용 override로 우선한다 — 운영에서는 TestRoleMap이
   * 항상 비어 있으므로(fail-fast, `AuthConfig`) DB role만 노출된다.
   */
  role: Role | null;

  private constructor(user: AuthUser, role: Role | null) {
    this.login = user.login;
    this.name = user.name;
    this.avatarUrl = user.avatarUrl;
    this.role = role;
  }

  static from(user: AuthUser, role: Role | null): MeResponseDto {
    return new MeResponseDto(user, role);
  }
}
