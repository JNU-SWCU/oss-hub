import type { AccountStatus, Role } from '@prisma/client';
import type { AdminUser } from '../domain/admin-user';

export class AdminUserResponseDto {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;

  private constructor(user: AdminUser) {
    this.id = user.id;
    this.githubLogin = user.githubLogin;
    this.name = user.name;
    this.role = user.role;
    this.accountStatus = user.accountStatus;
    this.isSelf = user.isSelf;
  }

  static from(user: AdminUser): AdminUserResponseDto {
    return new AdminUserResponseDto(user);
  }
}
