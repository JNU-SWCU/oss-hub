import type {
  DeletedTeamView,
  ProgramTeamView,
  RenamedTeamView,
  StaffTeamView,
  TeamMemberView,
} from '../program-teams.types';

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
  declare readonly deletedCounts: DeletedTeamView['deletedCounts'];

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
  declare readonly members: readonly TeamMemberView[];

  static from(view: StaffTeamView): StaffProgramTeamResponseDto {
    return {
      teamId: view.teamId,
      name: view.name,
      memberCount: view.memberCount,
      members: view.members,
    };
  }

  static fromAll(
    views: readonly StaffTeamView[],
  ): StaffProgramTeamResponseDto[] {
    return views.map((view) => StaffProgramTeamResponseDto.from(view));
  }
}

export class ProgramTeamResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly minMembers: number;
  declare readonly maxMembers: number;
  declare readonly hasApplication: boolean;
  declare readonly canInvite: boolean;
  declare readonly canRemoveMembers: boolean;
  declare readonly canLeave: boolean;
  declare readonly isLeader: boolean;
  declare readonly members: readonly TeamMemberView[];

  static from(view: ProgramTeamView): ProgramTeamResponseDto {
    return {
      id: view.id,
      name: view.name,
      memberCount: view.memberCount,
      minMembers: view.minMembers,
      maxMembers: view.maxMembers,
      hasApplication: view.hasApplication,
      canInvite: view.canInvite,
      canRemoveMembers: view.canRemoveMembers,
      canLeave: view.canLeave,
      isLeader: view.isLeader,
      members: view.members,
    };
  }
}
