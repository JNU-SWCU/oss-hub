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

export interface ProgramTeamView {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number;
  readonly locked: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];
}
