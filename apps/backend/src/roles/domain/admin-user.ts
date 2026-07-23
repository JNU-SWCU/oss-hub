import type { AccountStatus, Role } from '@prisma/client';

export interface AdminUser {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;
}

export interface AdminUserListQuery {
  readonly query: string;
  readonly role?: Role;
}
