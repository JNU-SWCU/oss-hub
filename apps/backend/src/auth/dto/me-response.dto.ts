import { AccountStatus, Role } from '@prisma/client';
import { AuthUser } from '../domain/auth-user';

/** githubId(BigInt)는 노출하지 않는다 — JSON 직렬화 불가 + 외부 계약에 불필요. */
export class MeResponseDto {
  nickname: string;
  name: string | null;
  avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  /** 역할의 정식 소스는 DB `User.role`이다. */
  role: Role | null;

  private constructor(user: AuthUser, role: Role | null) {
    this.nickname = user.nickname;
    this.name = user.name;
    this.avatarUrl = user.avatarUrl;
    this.accountStatus = user.accountStatus;
    this.role = role;
  }

  static from(user: AuthUser, role: Role | null): MeResponseDto {
    return new MeResponseDto(user, role);
  }
}
