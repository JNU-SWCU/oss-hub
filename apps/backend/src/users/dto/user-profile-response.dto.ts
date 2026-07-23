import type { UserProfile } from '../domain/user-profile';

export class UserProfileResponseDto {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;

  private constructor(profile: UserProfile) {
    this.name = profile.name;
    this.studentId = profile.studentId;
    this.department = profile.department;
    this.isComplete = profile.isComplete;
  }

  static from(profile: UserProfile): UserProfileResponseDto {
    return new UserProfileResponseDto(profile);
  }
}
