interface ProgramTeamDirectoryMember {
  readonly userId: string;
  readonly displayName: string;
  readonly isLeader: boolean;
}

export interface ProgramTeamDirectoryEntry {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly ProgramTeamDirectoryMember[];
}
