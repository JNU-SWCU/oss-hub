export interface TeamMemberView {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

export interface CreatedTeamView {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;
}

/**
 * 교직원 전용 팀 목록의 한 팀 — 팀원 전원의 실명을 포함한다.
 * 학번·학과·연락처·이메일·참여코드·저장소 URL 은 담지 않는다.
 */
export interface StaffTeamView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
}

export interface ProgramTeamView {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number | null;
  readonly locked: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];
}
