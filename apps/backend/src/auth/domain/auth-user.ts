import { AccountStatus, MemberKind } from '@prisma/client';

export interface AuthUser {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  readonly sessionVersion: number;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;

  readonly isProfileComplete: boolean;
}

export interface ActiveAccountPrincipal extends AuthUser {
  readonly accountStatus: typeof AccountStatus.ACTIVE;
}

export interface AuthLoginResult {
  user: AuthUser;
  isNew: boolean;
}

export interface GithubProfile {
  githubId: bigint;
  login: string;
  name: string | null;
  avatarUrl: string | null;

  email: string | null;
}
