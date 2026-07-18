import { AuthUser } from '../domain/auth-user';
import { TestRole } from '../test-role-map';

/** githubId(BigInt)는 노출하지 않는다 — JSON 직렬화 불가 + 외부 계약에 불필요. */
export class MeResponseDto {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** 테스트 전용 역할 매핑(Issue #65) — 미등록 계정은 null, 운영에서는 항상 null. */
  role: TestRole | null;

  private constructor(user: AuthUser, role: TestRole | null) {
    this.login = user.login;
    this.name = user.name;
    this.avatarUrl = user.avatarUrl;
    this.role = role;
  }

  static from(user: AuthUser, role: TestRole | null): MeResponseDto {
    return new MeResponseDto(user, role);
  }
}
