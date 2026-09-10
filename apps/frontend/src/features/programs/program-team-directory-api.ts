import { apiClient } from '@/lib/api-client';

/** 公開 roster에 허용된 표시 정보만 받는다. 저장소와 개인 프로필은 포함하지 않는다. */
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
