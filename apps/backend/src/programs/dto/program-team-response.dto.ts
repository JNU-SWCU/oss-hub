import type {
  DeletedTeamView,
  ProgramTeamView,
  RenamedTeamView,
  StaffTeamView,
  TeamMemberView,
} from '../program-team-repository-evidence.repository';

export class TeamMemberResponseDto {
  declare readonly userId: string;
  declare readonly nickname: string;
  declare readonly name: string | null;
  declare readonly isLeader: boolean;

  static from(member: TeamMemberView): TeamMemberResponseDto {
    return {
      userId: member.userId,
      nickname: member.nickname,
      name: member.name,
      isLeader: member.isLeader,
    };
  }
}

export class RenameTeamResponseDto {
  declare readonly teamId: string;
  declare readonly name: string;

  static from(view: RenamedTeamView): RenameTeamResponseDto {
    return { teamId: view.teamId, name: view.name };
  }
}

export class DeleteTeamResponseDto {
  declare readonly teamId: string;
  declare readonly deleted: true;
  declare readonly deletedCounts: {
    readonly members: number;
    readonly teams: number;
    readonly invitations: number;
    readonly submissions: number;
    readonly submissionEvents: number;
    readonly detachedRepositories: number;
  };

  static from(view: DeletedTeamView): DeleteTeamResponseDto {
    return {
      teamId: view.teamId,
      deleted: view.deleted,
      deletedCounts: view.deletedCounts,
    };
  }
}

export class StaffProgramTeamResponseDto {
  declare readonly teamId: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly members: TeamMemberResponseDto[];

  static from(view: StaffTeamView): StaffProgramTeamResponseDto {
    return {
      teamId: view.teamId,
      name: view.name,
      memberCount: view.memberCount,
      members: view.members.map((member) => TeamMemberResponseDto.from(member)),
    };
  }
}

export class ProgramTeamResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly minMembers: number;
  declare readonly maxMembers: number;
  declare readonly status: ProgramTeamView['status'];
  declare readonly repositoryProvisioningStatus: ProgramTeamView['repositoryProvisioningStatus'];
  declare readonly canInvite: boolean;
  declare readonly canRemoveMembers: boolean;
  declare readonly canLeave: boolean;
  declare readonly isLeader: boolean;
  declare readonly members: TeamMemberResponseDto[];

  static from(view: ProgramTeamView): ProgramTeamResponseDto {
    return {
      id: view.id,
      name: view.name,
      memberCount: view.memberCount,
      minMembers: view.minMembers,
      maxMembers: view.maxMembers,
      status: view.status,
      repositoryProvisioningStatus: view.repositoryProvisioningStatus,
      canInvite: view.canInvite,
      canRemoveMembers: view.canRemoveMembers,
      canLeave: view.canLeave,
      isLeader: view.isLeader,
      members: view.members.map((member) => TeamMemberResponseDto.from(member)),
    };
  }
}
