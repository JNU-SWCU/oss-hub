import { AuthUser } from '../domain/auth-user';

/** githubId(BigInt)는 노출하지 않는다 — JSON 직렬화 불가 + 외부 계약에 불필요. */
export class MeResponseDto {
  login: string;
  name: string | null;
  avatarUrl: string | null;

  private constructor(user: AuthUser) {
    this.login = user.login;
    this.name = user.name;
    this.avatarUrl = user.avatarUrl;
  }

  static from(user: AuthUser): MeResponseDto {
    return new MeResponseDto(user);
  }
}
