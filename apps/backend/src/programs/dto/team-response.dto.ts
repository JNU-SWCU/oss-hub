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

/**
 * 이름 변경 응답 — 바뀐 이름만 돌려준다.
 * 팀장과 교직원이 같은 endpoint를 쓰므로 신청·저장소를 여기에 싣지 않는다.
 */
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

/**
 * 삭제 응답 — 실제로 거둔 수치를 확인 창이 보여준 것과 같은 축으로 돌려준다.
 * `detachedRepositories`는 지운 수가 아니라 연결만 끊은 저장소 수다.
 */
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

/**
 * 내 팀 응답 — view 의 필드를 하나씩 명시적으로 옮긴다(spread 금지).
 * 능력 플래그(`canInvite`/`canRemoveMembers`/`canLeave`)는 서버 계산 결과이며
 * 프런트가 같은 규칙을 다시 유추하지 않는다. 과거 `locked` 키는 내려주지 않는다.
 */
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
