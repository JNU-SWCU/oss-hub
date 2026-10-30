import { AccountStatus, MemberKind } from '@prisma/client';
import { AuthUser } from '../http-auth.types';

export class MeResponseDto {
  declare readonly nickname: string;
  declare readonly name: string | null;
  declare readonly avatarUrl: string | null;
  declare readonly accountStatus: AccountStatus;
  declare readonly memberKind: MemberKind | null;
  declare readonly hasStaffAccess: boolean;
  declare readonly hasAdminAccess: boolean;
  declare readonly isProfileComplete: boolean;

  static from(user: AuthUser): MeResponseDto {
    return {
      nickname: user.nickname,
      name: user.name,
      avatarUrl: user.avatarUrl,
      accountStatus: user.accountStatus,
      memberKind: user.memberKind,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
      isProfileComplete: user.isProfileComplete,
    };
  }
}

export class SessionResponseDto {
  declare readonly isAuthenticated: boolean;
  declare readonly user?: MeResponseDto;

  static from(user?: MeResponseDto): SessionResponseDto {
    if (user === undefined) return { isAuthenticated: false };
    return { isAuthenticated: true, user };
  }
}
