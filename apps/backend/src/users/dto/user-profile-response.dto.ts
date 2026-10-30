import type { UserProfile } from '../user-profile-record.policy';

export class UserProfileResponseDto {
  declare readonly name: string;
  declare readonly studentId: string | null;
  declare readonly staffNumber: string | null;
  declare readonly department: string | null;
  declare readonly phone: string | null;
  declare readonly isComplete: boolean;

  static from(profile: UserProfile): UserProfileResponseDto {
    return {
      name: profile.name,
      studentId: profile.studentId,
      staffNumber: profile.staffNumber,
      department: profile.department,
      phone: profile.phone,
      isComplete: profile.isComplete,
    };
  }
}
