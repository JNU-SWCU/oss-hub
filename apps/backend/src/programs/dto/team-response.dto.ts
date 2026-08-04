import type {
  CreatedTeamView,
  ProgramTeamView,
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

export class ProgramTeamResponseDto {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number | null;
  readonly locked: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];

  private constructor(view: ProgramTeamView) {
    this.id = view.id;
    this.name = view.name;
    this.memberCount = view.memberCount;
    this.minMembers = view.minMembers;
    this.maxMembers = view.maxMembers;
    this.locked = view.locked;
    this.isLeader = view.isLeader;
    this.members = view.members;
  }

  static from(view: ProgramTeamView): ProgramTeamResponseDto {
    return new ProgramTeamResponseDto(view);
  }
}
