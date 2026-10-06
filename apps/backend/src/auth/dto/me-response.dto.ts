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
