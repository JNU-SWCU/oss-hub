import type {
  CreatedTeamView,
  ProgramTeamView,
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

/**
 * 교직원 전용 팀 목록 항목 — 팀원 전원의 실명(`members[].name`)을 담는다.
 * 학번·학과·연락처·이메일·참여코드·저장소 URL 은 이 DTO 에 넣지 않는다.
 */
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
