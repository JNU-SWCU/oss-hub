import type {
  CreatedTeamView,
  DeletedTeamView,
  ProgramTeamView,
  RenamedTeamView,
  StaffTeamView,
  TeamMemberView,
} from '../program-teams.types';

export class CreateTeamResponseDto {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;

  private constructor(view: CreatedTeamView) {
    this.id = view.id;
    this.name = view.name;
    this.joinCode = view.joinCode;
    this.memberCount = view.memberCount;
  }

  static from(view: CreatedTeamView): CreateTeamResponseDto {
    return new CreateTeamResponseDto(view);
  }
}

export class RenameTeamResponseDto {
  readonly teamId: string;
  readonly name: string;

  private constructor(view: RenamedTeamView) {
    this.teamId = view.teamId;
    this.name = view.name;
  }

  static from(view: RenamedTeamView): RenameTeamResponseDto {
    return new RenameTeamResponseDto(view);
  }
}

export class DeleteTeamResponseDto {
  readonly teamId: string;
  readonly deleted: true;
  readonly deletedCounts: DeletedTeamView['deletedCounts'];

  private constructor(view: DeletedTeamView) {
    this.teamId = view.teamId;
    this.deleted = view.deleted;
    this.deletedCounts = view.deletedCounts;
  }

  static from(view: DeletedTeamView): DeleteTeamResponseDto {
    return new DeleteTeamResponseDto(view);
  }
}

export class StaffProgramTeamResponseDto {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];

  private constructor(view: StaffTeamView) {
    this.teamId = view.teamId;
    this.name = view.name;
    this.memberCount = view.memberCount;
    this.members = view.members;
  }

  static from(view: StaffTeamView): StaffProgramTeamResponseDto {
    return new StaffProgramTeamResponseDto(view);
  }

  static fromAll(
    views: readonly StaffTeamView[],
  ): StaffProgramTeamResponseDto[] {
    return views.map((view) => StaffProgramTeamResponseDto.from(view));
  }
}

export class ProgramTeamResponseDto {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];

  private constructor(view: ProgramTeamView) {
    this.id = view.id;
    this.name = view.name;
    this.memberCount = view.memberCount;
    this.minMembers = view.minMembers;
    this.maxMembers = view.maxMembers;
    this.hasApplication = view.hasApplication;
    this.canInvite = view.canInvite;
    this.canRemoveMembers = view.canRemoveMembers;
    this.canLeave = view.canLeave;
    this.isLeader = view.isLeader;
    this.members = view.members;
  }

  static from(view: ProgramTeamView): ProgramTeamResponseDto {
    return new ProgramTeamResponseDto(view);
  }
}
