import type { UserProfile } from '../users.service';

class UserParticipationResponseDto {
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly teamName: string;
  declare readonly isLeader: boolean;

  static from(
    participation: UserProfile['participations'][number],
  ): UserParticipationResponseDto {
    return {
      programId: participation.programId,
      programName: participation.programName,
      teamName: participation.teamName,
      isLeader: participation.isLeader,
    };
  }
}

export class UserProfileResponseDto {
  declare readonly githubLogin: string;
  declare readonly memberKind: UserProfile['memberKind'];
  declare readonly name: string;
  declare readonly studentId: string | null;
  declare readonly staffNumber: string | null;
  declare readonly department: string | null;
  declare readonly phone: string | null;
  declare readonly isComplete: boolean;
  declare readonly participations: UserParticipationResponseDto[];

  static from(profile: UserProfile): UserProfileResponseDto {
    return {
      githubLogin: profile.githubLogin,
      memberKind: profile.memberKind,
      name: profile.name,
      studentId: profile.studentId,
      staffNumber: profile.staffNumber,
      department: profile.department,
      phone: profile.phone,
      isComplete: profile.isComplete,
      participations: profile.participations.map((participation) =>
        UserParticipationResponseDto.from(participation),
      ),
    };
  }
}
