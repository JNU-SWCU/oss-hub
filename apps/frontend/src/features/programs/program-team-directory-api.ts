import { apiClient } from '@/lib/api-client';

export interface ProgramTeamDirectoryMember {
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

export function getProgramTeamDirectory(
  programId: string,
): Promise<readonly ProgramTeamDirectoryEntry[]> {
  return apiClient<readonly ProgramTeamDirectoryEntry[]>(
    `programs/${encodeURIComponent(programId)}/overview/teams`,
  );
}
