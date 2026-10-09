import { AccountStatus, MemberKind } from '@prisma/client';
import { AuthUser } from '../domain/auth-user';

export class MeResponseDto {
  nickname: string;
  name: string | null;
  avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
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

export class SessionResponseDto {
  readonly isAuthenticated: boolean;
  readonly user?: MeResponseDto;

  private constructor(isAuthenticated: boolean, user?: MeResponseDto) {
    this.isAuthenticated = isAuthenticated;
    if (user) {
      this.user = user;
    }
  }

  static anonymous(): SessionResponseDto {
    return new SessionResponseDto(false);
  }

  static authenticated(user: MeResponseDto): SessionResponseDto {
    return new SessionResponseDto(true, user);
  }
}
